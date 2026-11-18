import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { examDeadline } from '../common/exam-deadline';
import { assertAnswerKeysReleased } from '../common/answer-key-release';
import { readExamQuestionVersion, EXAM_QUESTION_SNAPSHOT_SELECT } from '../common/exam-question-snapshots';
import { loadExamQuestions } from '../common/exam-question-sources';
import { canAccessExam, loadExamAudience } from '../students/exam-access';
import { studentQuestion } from '../students/student-question';
import { StorageService } from './storage.service';

/** Daftar berkas yang dirujuk satu ujian/bank disimpan sebentar di memori. */
const KEY_SET_TTL_MS = 60_000;
/** Berkas tak dikenal memicu hitung ulang paling cepat tiap 5 detik (soal baru diubah). */
const KEY_SET_REFRESH_MS = 5_000;

interface KeySetEntry { at: number; keys: Set<string>; pending?: Promise<Set<string>> }
interface BankIndexEntry { at: number; byKey: Map<string, Set<string>>; banks: Array<{ id: string }>; pending?: Promise<BankIndexEntry> }

@Injectable()
export class StorageAccessService {
    /**
     * Setiap gambar soal dulu memicu pemeriksaan penuh: semua pengerjaan siswa,
     * seluruh soal tiap ujian (dua kali untuk ujian selesai), atau seluruh soal
     * semua bank untuk staf — lalu menelusuri semuanya per gambar. Saat ujian
     * ramai ini membebani PostgreSQL dan API sampai gambar gagal dimuat. Kini
     * daftar berkas per ujian/bank dihitung sekali dan disimpan singkat; aturan
     * izinnya (pengerjaan aktif, tenggat, rilis kunci, hak bank) tetap diperiksa
     * pada setiap permintaan.
     */
    private readonly keySets = new Map<string, KeySetEntry>();
    private readonly bankIndexes = new Map<string, BankIndexEntry>();

    constructor(private readonly db: DbService, private readonly authz: AuthorizationService,
        private readonly storage: StorageService) {}

    /** Semua kunci berkas yang dirujuk lewat URL lengkap (termasuk di dalam teks kaya). */
    referencedKeys(value: unknown, into = new Set<string>()): Set<string> {
        if (typeof value === 'string') {
            if (!value.includes('/api/storage/file/') && !/https?:\/\//.test(value)) return into;
            const urls = value.replace(/&amp;/g, '&').match(/(?:https?:\/\/|\/api\/storage\/file\/)[^\s<>"']+/g) || [];
            for (const url of urls) {
                const key = this.storage.objectKeyFromUrl(url);
                if (key) into.add(key);
            }
        } else if (Array.isArray(value)) {
            for (const item of value) this.referencedKeys(item, into);
        } else if (value && typeof value === 'object') {
            for (const item of Object.values(value)) this.referencedKeys(item, into);
        }
        return into;
    }

    /** Match complete URLs, including URLs embedded in rich text; never substring-match object keys. */
    references(value: unknown, key: string): boolean {
        return this.referencedKeys(value).has(key);
    }

    /** Apakah `key` dirujuk konten `cacheKey`; dihitung ulang bila basi atau berkas belum dikenal. */
    private async cachedHasKey(cacheKey: string, build: () => Promise<Set<string>>, key: string): Promise<boolean> {
        const load = async (force: boolean): Promise<Set<string>> => {
            const entry = this.keySets.get(cacheKey);
            const age = entry ? Date.now() - entry.at : Infinity;
            if (entry && !force && age < KEY_SET_TTL_MS) return entry.keys;
            if (entry?.pending) return entry.pending;
            const pending = build().then(keys => {
                this.keySets.set(cacheKey, { at: Date.now(), keys });
                return keys;
            }).catch(error => {
                if (entry) this.keySets.set(cacheKey, { at: entry.at, keys: entry.keys });
                else this.keySets.delete(cacheKey);
                throw error;
            });
            this.keySets.set(cacheKey, { at: entry?.at ?? 0, keys: entry?.keys ?? new Set(), pending });
            return pending;
        };
        if ((await load(false)).has(key)) return true;
        const entry = this.keySets.get(cacheKey);
        if (entry && !entry.pending && Date.now() - entry.at < KEY_SET_REFRESH_MS) return false;
        return (await load(true)).has(key);
    }

    /** Peta berkas → bank yang merujuknya, untuk seluruh bank satu sekolah. */
    private async bankIndex(organizationId: string, force: boolean): Promise<BankIndexEntry> {
        const entry = this.bankIndexes.get(organizationId);
        if (entry && !force && Date.now() - entry.at < KEY_SET_TTL_MS) return entry;
        if (entry?.pending) return entry.pending;
        const pending = (async () => {
            const { data: banks, error } = await this.db.from('cbt_question_banks')
                .select('id, image_url').eq('organization_id', organizationId);
            if (error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
            const rows = (banks || []) as Array<{ id: string; image_url?: string | null }>;
            const byKey = new Map<string, Set<string>>();
            const add = (bankId: string, value: unknown) => {
                for (const key of this.referencedKeys(value)) {
                    if (!byKey.has(key)) byKey.set(key, new Set());
                    byKey.get(key)!.add(bankId);
                }
            };
            for (const bank of rows) add(bank.id, bank);
            const ids = rows.map(bank => bank.id);
            for (let i = 0; i < ids.length; i += 200) {
                const chunk = ids.slice(i, i + 200);
                for (const [table, select] of [['cbt_bank_questions', EXAM_QUESTION_SNAPSHOT_SELECT],
                    ['cbt_question_stimuli', '*'], ['cbt_question_instructions', '*']] as const) {
                    const { data, error: readError } = await this.db.from(table).select(select).in('bank_id', chunk);
                    if (readError) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
                    for (const row of (data || []) as Array<{ bank_id: string }>) add(row.bank_id, row);
                }
            }
            const built: BankIndexEntry = { at: Date.now(), byKey, banks: rows.map(bank => ({ id: bank.id })) };
            this.bankIndexes.set(organizationId, built);
            return built;
        })().catch(error => {
            if (entry) this.bankIndexes.set(organizationId, { ...entry, pending: undefined });
            else this.bankIndexes.delete(organizationId);
            throw error;
        });
        this.bankIndexes.set(organizationId, { at: entry?.at ?? 0, byKey: entry?.byKey ?? new Map(), banks: entry?.banks ?? [], pending });
        return pending;
    }

    /** Cover bank soal yang dipakai ujian terbit yang dapat diakses siswa (aturan sama dengan jadwal siswa). */
    private async studentCanReadCover(audience: Awaited<ReturnType<typeof loadExamAudience>>, key: string): Promise<boolean> {
        const { data: banks, error } = await this.db.from('cbt_question_banks').select('id, image_url')
            .eq('organization_id', audience.organizationId);
        if (error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
        const bankIds = ((banks || []) as Array<{ id: string; image_url?: string | null }>)
            .filter(bank => this.references(bank.image_url, key)).map(bank => bank.id);
        if (!bankIds.length) return false;
        const [direct, sources] = await Promise.all([
            this.db.from('cbt_exams').select('id, organization_id, is_published, metadata').in('question_bank_id', bankIds),
            this.db.from('cbt_exam_question_sources').select('exam_id').in('bank_id', bankIds),
        ]);
        if (direct.error || sources.error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
        const exams = [...((direct.data || []) as any[])];
        const extraIds = [...new Set(((sources.data || []) as Array<{ exam_id: string }>).map(row => row.exam_id))]
            .filter(id => !exams.some(exam => exam.id === id));
        if (extraIds.length) {
            const { data, error: extraError } = await this.db.from('cbt_exams').select('id, organization_id, is_published, metadata').in('id', extraIds);
            if (extraError) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
            exams.push(...((data || []) as any[]));
        }
        return exams.some(exam => canAccessExam(exam, audience));
    }

    /** Hak staf membaca satu bank (sama dengan aturan sebelumnya). */
    private async staffCanReadBank(user: AuthUser, bankId: string, organizationId: string): Promise<boolean> {
        try { await this.authz.assertBankAccess(user, bankId, 'read'); return true; }
        catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
            if ((user.roles || []).some(role => role.toUpperCase() === 'PROKTOR')) return false;
            await this.authz.assertOrgStaff(user, organizationId);
            const { data: sessions, error: sessionError } = await this.db.from('cbt_question_bank_validations')
                .select('id').eq('bank_id', bankId).eq('organization_id', organizationId);
            if (sessionError) throw new ForbiddenException('Izin validator belum dapat diperiksa.');
            const { data: assignments, error: assignmentError } = await this.db.from('cbt_question_bank_validators')
                .select('id').eq('validator_id', user.id).in('validation_id', (sessions || []).map((session: { id: string }) => session.id));
            if (assignmentError) throw new ForbiddenException('Izin validator belum dapat diperiksa.');
            return Boolean(assignments?.length);
        }
    }

    /**
     * Lampiran `assignments/<examId>/<userId>` hanya boleh dibuat oleh peserta
     * yang sedang mengerjakan ujian itu, atau oleh staf ujian tersebut. Tanpa
     * ini siswa dapat menitipkan berkas ke folder ujian mana pun, dan berkasnya
     * otomatis terbaca oleh staf ujian tersebut.
     */
    async assertAssignmentUpload(user: AuthUser, examId: string): Promise<void> {
        if (!user) throw new ForbiddenException('Sesi tidak valid.');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(examId || '')) {
            throw new ForbiddenException('Folder tugas tidak valid.');
        }
        const { data: attempts, error } = await this.db.from('cbt_exam_attempts').select('id')
            .eq('exam_id', examId).eq('user_id', user.id).eq('status', 'in_progress').limit(1);
        if (error) throw new ForbiddenException('Izin unggah belum dapat diperiksa.');
        if ((attempts || []).length) return;
        await this.authz.assertExamStaff(user, examId);
    }

    async assertRead(user: AuthUser, key: string): Promise<void> {
        if (!user) throw new ForbiddenException('Sesi tidak valid.');
        if (key.startsWith('exam-evidence/')) throw new ForbiddenException('Gunakan akses bukti ujian yang terotorisasi.');
        if (key.startsWith(`users/${user.id}/`)) return; // uploader preview, including unsaved drafts
        if (key.startsWith('assignments/')) {
            const [, examId, owner] = key.split('/');
            if (owner === user.id) return;
            await this.authz.assertExamStaff(user, examId);
            return;
        }
        const audience = await loadExamAudience(this.db, user);
        if (!audience.organizationId) throw new ForbiddenException('Berkas tidak tersedia.');
        const staff = user.isPlatformAdmin || user.resolved?.superadmin ||
            (user.roles || []).some(role => ['ADMIN', 'PROKTOR', 'GURU'].includes(role.toUpperCase()));
        if (staff) {
            // Hanya bank yang benar-benar merujuk berkas ini yang diperiksa haknya.
            const candidates = async (force: boolean) => {
                const index = await this.bankIndex(audience.organizationId!, force);
                const ids = new Set(index.byKey.get(key) || []);
                for (const bank of index.banks) if (key.startsWith(`banks/${bank.id}/`)) ids.add(bank.id);
                return { ids, at: index.at };
            };
            let found = await candidates(false);
            if (!found.ids.size && Date.now() - found.at >= KEY_SET_REFRESH_MS) found = await candidates(true);
            for (const bankId of found.ids) {
                if (await this.staffCanReadBank(user, bankId, audience.organizationId)) return;
            }
        }
        // Cover bank soal tampil di jadwal/hasil siswa: boleh dibuka bila bank itu
        // dipakai ujian terbit yang memang ditugaskan kepada siswa ini.
        if (/^users\/[^/]+\/banks\//.test(key) && await this.studentCanReadCover(audience, key)) return;
        const { data: attempts, error } = await this.db.from('cbt_exam_attempts')
            .select('exam_id, status, started_at, personal_end_time, metadata').eq('user_id', user.id);
        if (error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
        // Ujian yang sedang dikerjakan lebih dulu: itulah yang memuat gambar saat ujian.
        const ordered = [...(attempts || [])]
            .filter(attempt => ['in_progress', 'submitted', 'auto_submitted'].includes(attempt.status))
            .sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress'));
        if (!ordered.length) throw new ForbiddenException('Berkas tidak tersedia untuk sesi Anda.');
        const { data: exams, error: examError } = await this.db.from('cbt_exams').select('*')
            .in('id', [...new Set(ordered.map(attempt => attempt.exam_id))]);
        if (examError) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
        const examById = new Map(((exams || []) as any[]).map(exam => [exam.id, exam]));
        const [clock] = await this.db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = new Date(clock.now);
        for (const attempt of ordered) {
            const exam = examById.get(attempt.exam_id);
            if (!exam || exam.organization_id !== audience.organizationId) continue;
            if (attempt.status === 'in_progress') {
                if (!canAccessExam(exam, audience)) continue;
                const deadline = examDeadline(attempt, exam);
                if (attempt.metadata?.recovery_submit_only || !Number.isFinite(deadline.getTime()) || now >= deadline ||
                    (exam.start_time && now < new Date(exam.start_time))) continue;
                if (this.references({ document: exam.metadata?.document_url, description: exam.metadata?.assignment_description }, key)) return;
                // Soal versi siswa (tanpa kunci/pembahasan); urutan opsi tidak memengaruhi daftar berkas.
                if (await this.cachedHasKey(`exam-student:${exam.id}`, async () => this.referencedKeys(
                    (await readExamQuestionVersion(this.db, exam.id)).map(q => studentQuestion(q, exam.id))), key)) return;
            } else {
                try { await assertAnswerKeysReleased(this.db, exam); }
                catch (error) { if (error instanceof ForbiddenException) continue; throw error; }
                // Released historical details intentionally use the latest bank content.
                if (await this.cachedHasKey(`exam-review:${exam.id}:${exam.question_bank_id || ''}`, async () => {
                    const questions = await loadExamQuestions(this.db, exam.id, EXAM_QUESTION_SNAPSHOT_SELECT, exam.question_bank_id);
                    const frozen = await readExamQuestionVersion(this.db, exam.id);
                    return this.referencedKeys([...questions, ...frozen]);
                }, key)) return;
            }
        }
        throw new ForbiddenException('Berkas tidak tersedia untuk sesi Anda.');
    }
}
