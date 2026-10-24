import { hasStoredAnswer } from '@acca-cbt/shared';
import { attemptHealth } from '../common/attempt-health';
import { MONITORING_EVENTS, connectionLostAtClose } from '../common/exam-monitoring';
import { readExamQuestionVersion, hasExamQuestionSnapshots, loadFrozenExamQuestions } from '../common/exam-question-snapshots';
import { examDeadline, hasActiveSubmitIntent } from '../common/exam-deadline';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { chunk } from '../common/chunk';
import { GradingService } from '../grading/grading.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { ScoringClient } from '../scoring/scoring.client';
import { loadPasParticipantLocations } from '../common/pas-participant-location';

/** Batas id per klausa `IN (...)`, supaya pernyataan SQL tidak membengkak. */
const ID_BATCH = 300;

/** Peristiwa administratif — bukan pelanggaran, tidak ikut dihitung. */
const NON_VIOLATION_EVENTS = [...MONITORING_EVENTS, 'DEVICE_SWITCH_BLOCKED', 'LATE_ANSWER_SYNC', 'RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED', 'FORCE_TERMINATED', 'focus_interruption'];

/** Peristiwa yang dianggap "pindah tab" pada rincian pelanggaran. */
const TAB_SWITCH_EVENTS = ['tab_switch', 'window_blur', 'blur'];

const VIOLATION_LABELS: Record<string, string> = {
    tab_switch: 'Berpindah tab atau aplikasi',
    window_blur: 'Jendela ujian kehilangan fokus',
    blur: 'Jendela ujian kehilangan fokus',
    exit_fullscreen: 'Keluar dari layar penuh',
    restricted_shortcut: 'Menekan pintasan keyboard terlarang',
    copy_paste_attempt: 'Mencoba menyalin atau menempel',
    right_click_attempt: 'Mencoba membuka menu klik kanan',
    tab_close: 'Menutup atau meninggalkan tab ujian',
};

/**
 * Toleransi sebelum pengerjaan yang lewat tenggat ditutup otomatis.
 *
 * Jeda satu menit ini menghindari menutup pengerjaan siswa yang jamnya baru saja
 * habis sementara permintaan submit-nya masih dalam perjalanan.
 */
const AUTO_FINISH_GRACE_MS = 60 * 1000;

/**
 * Pemantauan ujian dan hasilnya untuk staf: daftar pengerjaan, analisis butir,
 * rincian satu pengerjaan, dan penilaian tugas.
 *
 * Dipindahkan dari `apps/web/app/actions/proktor.ts`.
 *
 * Yang HILANG di sini dan itu memang disengaja: `fetchAllRows`. Helper itu ada
 * untuk melewati cap 1000 baris PostgREST — sebuah `.select()` yang cocok dengan
 * lebih dari 1000 baris dipotong diam-diam, tanpa galat, sehingga analisis butir
 * pada ujian besar salah hitung. Adapter NestJS berbicara langsung ke PostgreSQL
 * lewat SQL mentah; tidak ada cap semacam itu, dan `LIMIT` hanya muncul kalau
 * kita yang meminta.
 */
@Injectable()
export class ExamMonitoringService {
    private readonly logger = new Logger(ExamMonitoringService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly scoring: ScoringClient,
        private readonly grading: GradingService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    /**
     * Daftar pengerjaan sebuah ujian, ditambah siswa yang BELUM memulai.
     *
     * Siswa yang belum mulai ikut ditampilkan sebagai baris berstatus `belum` —
     * tanpa itu, layar pemantauan hanya memperlihatkan yang sudah masuk dan
     * pengawas tidak bisa melihat siapa yang tertinggal.
     */
    async listAttempts(user: AuthUser, examId: string) {
        const studentIds = await this.authz.assertExamMonitoring(user, examId);
        const allowedStudents = studentIds === undefined ? null : new Set(studentIds);

        // Pengerjaan yang tenggatnya lewat ditutup lebih dulu, supaya status
        // "sedang mengerjakan" di layar benar-benar berarti sedang mengerjakan.
        await this.finalizeExpired(examId);

        const { data, error } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, status, total_score, score_irt, irt_theta, needs_manual_grading,
                 started_at, finished_at, tab_switch_count, warning_count, exam_id, user_id,
                 last_seen_at, personal_end_time, metadata, device_fingerprint,
                 profiles:cbt_profiles(full_name, identity_number)`,
            )
            .eq('exam_id', examId)
            .order('started_at', { ascending: false });

        if (error) {
            throw new BadRequestException('Data monitoring belum dapat dibaca.');
        }

        const attempts = ((data as any[]) || []).filter(attempt => !allowedStudents || allowedStudents.has(attempt.user_id));
        const attemptIds = attempts.map((a) => a.id);
        const attemptUserIds = new Set(attempts.map((a) => a.user_id).filter(Boolean));

        const [assigned, logs] = await Promise.all([
            this.loadAssignedStudents(examId),
            this.loadSecurityLogs(attemptIds),
        ]);

        // Siswa yang punya pengerjaan tetapi kelasnya tidak termasuk sasaran
        // ujian — mis. peserta perorangan — tetap perlu nama kelasnya.
        const unmapped = [...attemptUserIds].filter((id) => !assigned.classByUser.has(id));
        if (unmapped.length > 0) {
            for (const ids of chunk(unmapped, ID_BATCH)) {
                const { data: memberships } = await this.db
                    .from('cbt_class_members')
                    .select('user_id, class_id, classes:cbt_classes(name)')
                    .in('user_id', ids);

                for (const row of (memberships as any[]) || []) {
                    appendClassName(assigned.classByUser, row);
                }
            }
        }

        const [{ data: exam }, questions] = await Promise.all([
            this.db.from('cbt_exams').select('id, organization_id, created_by, exam_type, start_time, end_time, duration_minutes').eq('id', examId).maybeSingle(),
            readExamQuestionVersion(this.db, examId),
        ]);
        const resetScope = exam ? await this.authz.getExamResetScope?.(user, { ...exam, id: examId }) : null;
        const resetStudents = new Set(resetScope?.studentIds || []);
        const canReset = (studentId: string) => Boolean(resetScope?.allParticipants || resetStudents.has(studentId));
        const questionIds = new Set(questions.map(question => question.id));
        const answersByAttempt = new Map<string, any[]>();
        for (const ids of chunk(attemptIds, ID_BATCH)) {
            const { data: saved, error: savedError } = await this.db.from('cbt_answers')
                .select('attempt_id, question_id, selected_option_id, essay_answer, metadata').in('attempt_id', ids);
            if (savedError) throw new BadRequestException('Status penyimpanan jawaban belum dapat dibaca.');
            for (const answer of saved || []) {
                if (!questionIds.has(answer.question_id)) continue;
                const rows = answersByAttempt.get(answer.attempt_id) || [];
                rows.push(answer); answersByAttempt.set(answer.attempt_id, rows);
            }
        }
        const actorIds = [...new Set([...logs.values()].flat().map(log => log.metadata?.actor_user_id).filter(Boolean))];
        const actorNames = new Map<string, string>();
        for (const ids of chunk(actorIds, ID_BATCH)) {
            const { data: actors } = await this.db.from('cbt_profiles').select('id, full_name').in('id', ids);
            for (const actor of actors || []) actorNames.set(actor.id, actor.full_name);
        }
        const nowRows = await this.db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = new Date(nowRows[0].now);
        const rows: any[] = attempts.map(attempt => {
            const history = (logs.get(attempt.id) || []).map(log => ({
                type: log.event_type, at: log.created_at,
                actor_id: log.metadata?.actor_user_id || null,
                actor_name: actorNames.get(log.metadata?.actor_user_id) || null,
                reason: log.metadata?.reason || null,
                previous_deadline: log.metadata?.previous_deadline || null,
                recovery_until: log.metadata?.recovery_until || null,
                device_released: log.metadata?.device_released === true,
                device_context: log.metadata?.attempted_context ?? null,
                abandoned_local_answers: log.metadata?.abandoned_local_answers ?? null,
                pending_answer_count: log.metadata?.pendingAnswerCount ?? null,
                storage_state: log.metadata?.storageState || null,
                gap_seconds: log.metadata?.gap_seconds ?? null,
                last_seen_at: log.metadata?.last_seen_at || null,
                observed_again_at: log.metadata?.observed_again_at || null,
                disconnected_at: log.metadata?.disconnected_at || null,
                remaining_at_disconnect_seconds: log.metadata?.remaining_at_disconnect_seconds ?? null,
                remaining_at_last_seen_seconds: log.metadata?.remaining_at_last_seen_seconds ?? null,
                remaining_at_reconnect_seconds: log.metadata?.remaining_at_reconnect_seconds ?? null,
                original_event_type: log.metadata?.original_event_type || null,
                late_reason: log.metadata?.late_reason || null,
                event_at: log.metadata?.timestamp || null,
                deadline_at: log.metadata?.deadline_at || null,
            }));
            if (attempt.started_at) history.push({ type: 'ATTEMPT_STARTED', at: attempt.started_at } as any);
            // Penyelesaian oleh staf sudah tercatat sebagai FORCE_TERMINATED beserta alasannya.
            if (attempt.finished_at && !attempt.metadata?.closed_by_staff) history.push({ type: attempt.status === 'submitted' ? 'SUBMITTED' : 'AUTO_SUBMITTED', at: attempt.finished_at } as any);
            history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
            return { ...attempt,
                canReset: canReset(attempt.user_id),
                kelas_name: assigned.classByUser.get(attempt.user_id) || '-',
                violation_breakdown: summariseViolations(logs.get(attempt.id) || []),
                ...attemptHealth(attempt, exam || {}, answersByAttempt.get(attempt.id) || [], now, questions.length,
                    logs.get(attempt.id) || []),
                // ID perangkat mentah tidak perlu sampai ke browser pengawas.
                device_fingerprint: undefined,
                monitoring_history: history,
            };
        });

        for (const [userId, profile] of assigned.profileByUser) {
            if (allowedStudents && !allowedStudents.has(userId)) continue;
            if (attemptUserIds.has(userId)) continue;

            rows.push({
                id: `unstarted-${userId}`,
                // Siswa yang belum mulai hanya dapat diberi susulan (pengerjaan baru).
                canReset: canReset(userId),
                status: 'belum',
                total_score: null,
                score_irt: null,
                irt_theta: null,
                needs_manual_grading: false,
                started_at: null,
                finished_at: null,
                tab_switch_count: 0,
                warning_count: 0,
                last_seen_at: null,
                exam_id: examId,
                user_id: userId,
                profiles: profile,
                kelas_name: assigned.classByUser.get(userId) || '-',
                violation_breakdown: { pindah_tab: 0, close_tab: 0, lainnya: 0 },
                connection_status: 'inactive', server_now: now.toISOString(),
                total_questions: questions.length, saved_answer_count: 0, unanswered_count: questions.length,
                grading_status: 'not_submitted', attention_reasons: [], monitoring_history: [],
            });
        }

        const locations = await loadPasParticipantLocations(this.db, exam || { id: examId }, rows.map(row => row.user_id));
        for (const row of rows) row.pas_location = locations.get(row.user_id) || null;
        const { data: screenShareExceptions, error: exceptionError } = await this.db.from('cbt_exam_screen_share_exceptions')
            .select('user_id, reason, created_at, created_by').eq('exam_id', examId);
        if (exceptionError) throw new BadRequestException('Pengecualian berbagi layar belum dapat dibaca.');
        const exceptionByStudent = new Map((screenShareExceptions || []).map((item: any) => [item.user_id, {
            reason: item.reason, created_at: item.created_at, created_by: item.created_by,
        }]));
        for (const row of rows) row.screen_share_exception = exceptionByStudent.get(row.user_id) || null;
        await this.fillMissingIdentityNumbers(rows);
        return rows;
    }

    /** Identitas lama dapat kosong; cocokkan master melalui UUID akun, bukan nama. */
    private async fillMissingIdentityNumbers(rows: any[]) {
        const missing = rows.filter(row => !String(row.profiles?.identity_number || '').trim());
        for (const ids of chunk([...new Set<string>(missing.map(row => row.user_id).filter(Boolean))], ID_BATCH)) {
            const { data, error } = await this.db.from('users').select('auth_id, nip').in('auth_id', ids);
            if (error) throw new BadRequestException('Identitas peserta dari master belum dapat dibaca.');
            const identities = new Map((data || []).map((row: any) => [row.auth_id, String(row.nip || '').trim()]));
            for (const row of missing) {
                const identity = identities.get(row.user_id);
                if (identity) row.profiles = { ...row.profiles, identity_number: identity };
            }
        }
    }

    /** Siswa di kelas-kelas yang ditugasi ujian ini, beserta nama kelasnya. */
    private async loadAssignedStudents(examId: string) {
        const classByUser = new Map<string, string>();
        const profileByUser = new Map<string, any>();

        const { data: targets, error: targetError } = await this.db
            .from('cbt_exam_targets')
            .select('class_id, additional_class_id')
            .eq('exam_id', examId);

        if (targetError) throw new BadRequestException('Daftar kelas peserta belum dapat dibaca.');

        const classIds = [
            ...new Set(
                ((targets as Array<{ class_id: string | null }>) || [])
                    .map((t) => t.class_id)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];

        for (const ids of chunk(classIds, 100)) {
            const { data, error: memberError } = await this.db
                .from('cbt_class_members')
                .select(
                    'user_id, class_id, profiles:cbt_profiles(full_name, identity_number), classes:cbt_classes(name)',
                )
                .in('class_id', ids);

            if (memberError) throw new BadRequestException('Daftar siswa kelas belum dapat dibaca.');

            for (const row of (data as any[]) || []) {
                appendClassName(classByUser, row);

                if (!profileByUser.has(row.user_id)) {
                    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                    profileByUser.set(row.user_id, profile ?? null);
                }
            }
        }

        const additionalIds = (targets || []).map((row: any) => row.additional_class_id).filter(Boolean);
        for (const ids of chunk(additionalIds, ID_BATCH)) {
            const { data: members, error: memberError } = await this.db.from('cbt_additional_class_members')
                .select('user_id, class_id, profiles:cbt_profiles(full_name, identity_number), classes:cbt_additional_classes(name)').in('class_id', ids);
            if (memberError) throw new BadRequestException('Daftar siswa kelas tambahan belum dapat dibaca.');
            for (const row of members || []) {
                appendClassName(classByUser, row);
                if (!profileByUser.has(row.user_id)) profileByUser.set(row.user_id, Array.isArray(row.profiles) ? row.profiles[0] : row.profiles);
            }
        }
        const { data: participants, error: participantError } = await this.db.from('cbt_exam_participants').select('user_id').eq('exam_id', examId);
        if (participantError) throw new BadRequestException('Daftar peserta perorangan belum dapat dibaca.');
        const individualIds: string[] = (participants || []).map((row: any) => row.user_id).filter((id: string) => Boolean(id) && !profileByUser.has(id));
        for (const ids of chunk(individualIds, ID_BATCH)) {
            const { data: profiles, error: profileError } = await this.db.from('cbt_profiles').select('id, full_name, identity_number').in('id', ids);
            if (profileError) throw new BadRequestException('Profil peserta belum dapat dibaca.');
            for (const id of ids) profileByUser.set(id, null);
            for (const profile of profiles || []) profileByUser.set(profile.id, profile);
        }
        return { classByUser, profileByUser };
    }

    private async loadSecurityLogs(attemptIds: string[]) {
        const byAttempt = new Map<string, Array<{ event_type: string; created_at: string; metadata?: Record<string, any> }>>();
        if (attemptIds.length === 0) return byAttempt;

        for (const ids of chunk(attemptIds, ID_BATCH)) {
            const { data, error } = await this.db
                .from('cbt_attempt_security_logs')
                .select('attempt_id, event_type, created_at, metadata')
                .in('attempt_id', ids)
                .order('created_at', { ascending: true });

            if (error) throw new BadRequestException('Riwayat pengerjaan belum dapat dibaca.');
            for (const log of (data as any[]) || []) {
                (byAttempt.get(log.attempt_id) ??
                    byAttempt.set(log.attempt_id, []).get(log.attempt_id)!)
                    .push(log);
            }
        }

        return byAttempt;
    }

    /**
     * Tutup pengerjaan yang tenggatnya sudah lewat, dan nilai dari jawaban
     * tersimpan.
     *
     * Tenggat pribadi diambil dari `personal_end_time`; baris lama yang kosong
     * disusun ulang dari `started_at` + durasi. Penutupan jendela ujian selalu
     * menjadi batas atasnya.
     */
    private async finalizeExpired(examId: string): Promise<void> {
        const { data: examRow, error: examError } = await this.db
            .from('cbt_exams')
            .select('end_time, duration_minutes')
            .eq('id', examId)
            .maybeSingle();

        const { data: openRows, error: openError } = await this.db
            .from('cbt_exam_attempts')
            .select('id, started_at, personal_end_time, metadata')
            .eq('exam_id', examId)
            .eq('status', 'in_progress');

        if (examError || openError) throw new BadRequestException('Batas waktu pengerjaan belum dapat diperiksa.');

        const exam = examRow as { end_time: string | null; duration_minutes: number | null } | null;
        if (!exam) return;
        // Read the clock once and avoid opening a transaction for every live
        // student. The locked check below still protects concurrent resets.
        const [clock] = await this.db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const observedNow = new Date(clock.now);
        const open = ((openRows as any[]) || []).filter(attempt => {
            if (hasActiveSubmitIntent(attempt.metadata, observedNow)) return false;
            const deadline = examDeadline(attempt, exam).getTime();
            return Number.isFinite(deadline) && deadline + AUTO_FINISH_GRACE_MS <= observedNow.getTime();
        });
        for (const attempt of open) {
            try {
                const closed = await this.db.transaction(async db => {
                    await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attempt.id);
                    const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                        .select('id, status, started_at, personal_end_time, metadata, last_seen_at')
                        .eq('id', attempt.id).maybeSingle();
                    if (readError) throw new Error(readError.message);
                    if (!current || current.status !== 'in_progress') return false;
                    const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
                    const now = new Date(clock.now);
                    if (hasActiveSubmitIntent(current.metadata, now)) return false;
                    const deadline = examDeadline(current, exam).getTime();
                    if (!Number.isFinite(deadline) || deadline + AUTO_FINISH_GRACE_MS > now.getTime()) return false;
                    const lost = connectionLostAtClose(current.last_seen_at, deadline, now);
                    const { data: updated, error } = await db.from('cbt_exam_attempts')
                        .update({ status: 'auto_submitted', total_score: null, finished_at: now.toISOString(), metadata: {
                            ...(current.metadata || {}), closed_by_expiry: true,
                            ...(lost ? { connection_lost_at_close: lost } : {}) } })
                        .eq('id', attempt.id).eq('status', 'in_progress').select('id').maybeSingle();
                    if (error) throw new Error(error.message);
                    if (updated && lost) {
                        const { error: logError } = await db.from('cbt_attempt_security_logs').insert({ attempt_id: attempt.id,
                            event_type: 'CONNECTION_LOST_AT_CLOSE', metadata: { ...lost, source: 'server_monitoring' } });
                        if (logError) throw new Error(logError.message);
                    }
                    return Boolean(updated);
                });
                if (!closed) continue;

                const graded = await this.grading.gradeAttemptFromSavedAnswers(attempt.id);
                if (graded) {
                    await this.grading.applyRelativeQuizScoringIfQuiz(graded.examId);
                }
            } catch (err) {
                this.logger.error(
                    `Gagal menutup pengerjaan ${attempt.id}: ${(err as Error).message}`,
                );
            }
        }

        // Status auto_submitted + nilai null adalah antrean durable. Jalur ini
        // tetap berjalan walau tidak ada attempt aktif, sehingga kegagalan Python
        // pada polling sebelumnya dapat pulih saat layanan kembali sehat.
        await this.grading.retryPendingAutoSubmissions(examId);
    }

    /**
     * Staf menyelesaikan pengerjaan seorang siswa yang sedang berlangsung.
     *
     * Hanya pengelola ujian (pembuat ujian, Proktor/Admin sesuai aturan
     * `canManageExam`) — bukan pengawas ruang. Diperlakukan seperti waktu habis
     * saat itu juga: jawaban yang sudah tersimpan di server dinilai. Berbeda dari
     * penutupan karena waktu, siswa TIDAK boleh mengirim salinan lokal susulan
     * (`closed_by_expiry` tidak diset), sehingga layar siswa menerima "Sesi
     * ditutup oleh pengawas" pada simpan/kumpul berikutnya.
     */
    async finishAttempt(user: AuthUser, attemptId: string, reason: string) {
        const normalizedReason = String(reason || '').trim();
        if (!normalizedReason) throw new BadRequestException('Tuliskan alasan menyelesaikan pengerjaan.');

        const { data: found, error: findError } = await this.db.from('cbt_exam_attempts')
            .select('id, exam_id').eq('id', attemptId).maybeSingle();
        if (findError) throw new BadRequestException('Pengerjaan belum dapat dibaca.');
        if (!found) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const { data: exam, error: examError } = await this.db.from('cbt_exams')
            .select('id, organization_id, created_by, exam_type, is_published')
            .eq('id', (found as { exam_id: string }).exam_id).maybeSingle();
        if (examError) throw new BadRequestException('Ujian belum dapat dibaca.');
        if (!exam || !(await this.authz.canManageExam(user, exam as any))) {
            throw new ForbiddenException('Hanya pengelola ujian yang dapat menyelesaikan pengerjaan siswa.');
        }

        const closedAt = await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: current, error } = await db.from('cbt_exam_attempts')
                .select('id, status, metadata').eq('id', attemptId).maybeSingle();
            if (error) throw new BadRequestException('Pengerjaan belum dapat dibaca.');
            if (!current) throw new NotFoundException('Pengerjaan tidak ditemukan.');
            if (current.status !== 'in_progress') {
                throw new ConflictException('Pengerjaan ini sudah selesai.');
            }
            const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            const now = new Date(clock.now);
            if (hasActiveSubmitIntent(current.metadata, now)) {
                throw new ConflictException('Siswa sedang mengumpulkan jawabannya. Tunggu sebentar lalu muat ulang data.');
            }
            const { data: updated, error: updateError } = await db.from('cbt_exam_attempts')
                .update({
                    status: 'auto_submitted', total_score: null, finished_at: now.toISOString(),
                    metadata: { ...(current.metadata || {}), closed_by_staff: {
                        by: user.id, at: now.toISOString(), reason: normalizedReason,
                    } },
                })
                .eq('id', attemptId).eq('status', 'in_progress').select('id').maybeSingle();
            if (updateError) throw new BadRequestException('Pengerjaan belum berhasil diselesaikan.');
            if (!updated) throw new ConflictException('Pengerjaan ini sudah selesai.');
            // Jejak yang sama dengan penghentian oleh proktor, supaya muncul di
            // riwayat aktivitas monitoring beserta pelaku dan alasannya.
            const { error: logError } = await db.from('cbt_attempt_security_logs').insert({
                attempt_id: attemptId,
                event_type: 'FORCE_TERMINATED',
                metadata: { reason: normalizedReason, terminated_at: now.toISOString(), actor_user_id: user.id, closed_by_staff: true },
            });
            if (logError) throw new BadRequestException('Jejak penyelesaian gagal disimpan.');
            return now.toISOString();
        });

        // Penilaian di luar transaksi: kegagalan layanan nilai tidak membatalkan
        // penutupan, dan status auto_submitted + nilai null dicoba ulang otomatis.
        let graded = false;
        try {
            const result = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
            if (result) {
                graded = true;
                await this.grading.applyRelativeQuizScoringIfQuiz(result.examId);
            }
        } catch (err) {
            this.logger.error(`Penilaian pengerjaan ${attemptId} yang diselesaikan staf tertunda: ${(err as Error).message}`);
        }
        return { attemptId, status: 'auto_submitted', finishedAt: closedAt, graded };
    }

    /**
     * Pelanggaran terbaru sebuah ujian, untuk umpan "Pelanggaran Terbaru" di
     * layar pemantauan.
     *
     * Dibaca dari LOG di basis data, bukan dari siaran realtime. Versi lama
     * punya fungsi serupa tetapi tanpa satu pun pemanggil, sehingga umpan itu
     * hanya terisi oleh siaran Supabase — dan kosong sama sekali setelah halaman
     * dimuat ulang. Sejak Supabase tidak ada, umpannya tidak pernah terisi lagi.
     */
    async listRecentViolations(user: AuthUser, examId: string, limit: number) {
        const studentIds = await this.authz.assertExamMonitoring(user, examId);
        const allowedStudents = studentIds === undefined ? null : new Set(studentIds);

        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('id, user_id, warning_count, profiles:cbt_profiles(full_name)')
            .eq('exam_id', examId);

        const attempts = ((attemptRows as any[]) || []).filter(attempt => !allowedStudents || allowedStudents.has(attempt.user_id));
        if (attempts.length === 0) return [];

        const byId = new Map(attempts.map((a) => [a.id, a]));

        const { data: logs } = await this.db
            .from('cbt_attempt_security_logs')
            .select('attempt_id, event_type, created_at, metadata')
            .in(
                'attempt_id',
                attempts.map((a) => a.id),
            )
            .not('event_type', 'in', `(${NON_VIOLATION_EVENTS.map((e) => `"${e}"`).join(',')})`)
            .order('created_at', { ascending: false })
            .limit(limit);

        return ((logs as any[]) || []).map((log) => {
            const attempt = byId.get(log.attempt_id);
            // Relasi satu-ke-satu bisa terbaca sebagai objek atau array satu
            // elemen, tergantung bagaimana foreign key-nya terdaftar.
            const profile = Array.isArray(attempt?.profiles)
                ? attempt?.profiles[0]
                : attempt?.profiles;

            const seconds = log.metadata?.duration_seconds;

            return {
                // Satu baris per PERISTIWA, bukan per pengerjaan.
                id: `${log.attempt_id}:${log.created_at}`,
                attemptId: log.attempt_id,
                studentName: profile?.full_name || 'Tanpa nama',
                violationType: log.event_type,
                violationLabel: VIOLATION_LABELS[log.event_type] || 'Pelanggaran lain',
                violationCount: attempt?.warning_count ?? 0,
                timestamp: log.created_at,
                metadata: log.metadata || {},
                duration:
                    typeof seconds === 'number'
                        ? seconds >= 60
                            ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
                            : `${seconds}s`
                        : undefined,
            };
        });
    }

    /**
     * Data analisis butir: SELURUH soal bank beserta kunci jawabannya, ditambah
     * jawaban peserta.
     *
     * Jawaban yang `is_correct`-nya masih null — pengerjaan yang belum
     * dikumpulkan — dinilai saat itu juga lewat FastAPI. Tanpa itu, analisis
     * butir menghitung SEMUA jawaban peserta yang sedang mengerjakan sebagai
     * salah, dan angkanya menyesatkan justru saat ujian sedang berlangsung.
     */
    async getItemAnalysis(user: AuthUser, examId: string) {
        const studentIds = await this.authz.assertExamMonitoring(user, examId);
        const allowedStudents = studentIds === undefined ? null : new Set(studentIds);

        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('question_bank_id')
            .eq('id', examId)
            .maybeSingle();

        if (!examRow) throw new NotFoundException('Ujian tidak ditemukan.');
        const questionVersionSource = await hasExamQuestionSnapshots(this.db, examId) ? 'frozen' : 'legacy_current_bank';
        const sorted = await readExamQuestionVersion(this.db, examId) as any[];
        if (sorted.length === 0) return { questions: [], answers: [], detailed: null };

        const questionById = new Map(sorted.map((q) => [q.id, q]));

        const questions = sorted.map((question, index) => ({
            id: question.id,
            number: index + 1,
            question_text: question.question_text,
            type: question.type,
            score_default: Number(question.score_default ?? 1),
            metadata: question.metadata,
            options: [...(question.bank_question_options || [])]
                .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
                .map((option: any) => ({
                    id: option.id,
                    option_text: option.option_text,
                    is_correct: option.is_correct === true,
                    order: option.order || 0,
                    weight: option.weight,
                    metadata: option.metadata,
                })),
        }));

        const { data: attemptRows, error: attemptError } = await this.db
            .from('cbt_exam_attempts')
            .select('id, user_id, status, total_score, profiles:cbt_profiles(full_name, identity_number)')
            .eq('exam_id', examId);

        if (attemptError) throw new BadRequestException('Data peserta analisis belum dapat dibaca.');
        const attemptList = ((attemptRows as any[]) || []).filter(attempt => !allowedStudents || allowedStudents.has(attempt.user_id));
        await this.fillMissingIdentityNumbers(attemptList);
        const attemptIds = attemptList.map((a) => a.id);
        if (attemptIds.length === 0) return { questions, answers: [], detailed: null };

        const assigned = await this.loadAssignedStudents(examId);

        const participants = attemptList.map((att) => {
            const profile = Array.isArray(att.profiles) ? att.profiles[0] : att.profiles;
            const className = assigned.classByUser.get(att.user_id) || '-';
            return {
                attempt_id: att.id,
                user_id: att.user_id,
                student_name: profile?.full_name || 'Tanpa Nama',
                student_nis: profile?.identity_number || '-',
                class_name: className,
                status: att.status || 'submitted',
                total_score: att.total_score != null ? Number(att.total_score) : null,
            };
        });

        const raw: any[] = [];
        for (const ids of chunk(attemptIds, ID_BATCH)) {
            const { data, error: answerError } = await this.db
                .from('cbt_answers')
                .select('attempt_id, question_id, is_correct, selected_option_id, essay_answer, score')
                .in('attempt_id', ids);

            if (answerError) throw new BadRequestException('Jawaban analisis belum dapat dibaca.');
            raw.push(...((data as any[]) || []).filter(hasStoredAnswer));
        }

        const answers = await this.resolveCorrectness(raw, questionById);

        let detailed: any = null;
        try {
            detailed = await this.scoring.post(
                '/analytics/item-analysis-detailed',
                {
                    exam_id: examId,
                    questions,
                    participants,
                    answers,
                },
                { timeoutMs: 30_000 },
            );
        } catch (err) {
            this.logger.error(
                `Gagal memanggil Python detailed analysis: ${(err as Error).message}`,
            );
        }

        if (detailed) {
            detailed.question_version_source = questionVersionSource;
            const [clock] = await this.db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            detailed.generated_at = new Date(clock.now).toISOString();
        }
        return { questions, answers, detailed };
    }

    /**
     * Lengkapi `is_correct` yang masih kosong dengan menilai jawabannya sekarang.
     *
     * Seluruh jawaban yang belum dinilai dikirim ke FastAPI dalam SATU
     * permintaan, bukan satu per satu: ujian besar bisa punya puluhan ribu
     * jawaban yang belum dikumpulkan.
     */
    private async resolveCorrectness(
        rows: any[],
        questionById: Map<string, any>,
    ): Promise<
        Array<{
            attempt_id: string;
            question_id: string;
            is_correct: boolean | null;
            score?: number | null;
            selected_option_id?: string | null;
            essay_answer?: any;
        }>
    > {
        const settled: Array<{
            attempt_id: string;
            question_id: string;
            is_correct: boolean | null;
            score?: number | null;
            selected_option_id?: string | null;
            essay_answer?: any;
        }> = [];

        const pending: Array<{ row: any; key: string }> = [];
        const items: Array<{ question: any; answer_id: string; raw_answer: string }> = [];

        for (const row of rows) {
            const rawAnswer = row.essay_answer ?? row.selected_option_id;

            if (row.is_correct !== null && row.is_correct !== undefined) {
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: row.is_correct,
                    score: row.score != null ? Number(row.score) : null,
                    selected_option_id: row.selected_option_id ?? null,
                    essay_answer: row.essay_answer ?? null,
                });
                continue;
            }

            // Baris tanpa isi jawaban sama sekali — mis. hanya ditandai ragu —
            // bukan "menjawab", jadi ia tidak ikut dihitung.
            if (!rawAnswer) {
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: false,
                    score: 0,
                    selected_option_id: row.selected_option_id ?? null,
                    essay_answer: row.essay_answer ?? null,
                });
                continue;
            }

            const question = questionById.get(row.question_id);
            if (!question) continue;

            const key = `${row.attempt_id}:${row.question_id}`;
            pending.push({ row, key });
            items.push({ question, answer_id: key, raw_answer: rawAnswer });
        }

        if (items.length === 0) return settled;

        try {
            const result = await this.scoring.post<{
                items: Array<{
                    answer_id: string | null;
                    is_correct: boolean | null;
                    score?: number | null;
                }>;
            }>('/grading/attempt', { items });

            const byKey = new Map(result.items.map((item) => [item.answer_id, item]));

            for (const { row, key } of pending) {
                const graded = byKey.get(key);
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: graded?.is_correct ?? null,
                    score: graded?.score != null ? Number(graded.score) : null,
                    selected_option_id: row.selected_option_id ?? null,
                    essay_answer: row.essay_answer ?? null,
                });
            }
        } catch (err) {
            // Analisis tetap ditampilkan dari jawaban yang sudah dinilai; yang
            // belum dinilai dihilangkan, bukan dihitung sebagai salah.
            this.logger.error(
                `Penilaian jawaban berjalan gagal, analisis memakai data tersimpan saja: ${(err as Error).message}`,
            );
            for (const { row } of pending) {
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: null,
                    score: null,
                    selected_option_id: row.selected_option_id ?? null,
                    essay_answer: row.essay_answer ?? null,
                });
            }
        }

        return settled;
    }

    /**
     * Rincian lengkap satu pengerjaan: jawaban, soal, dan log keamanannya.
     *
     * Untuk pengerjaan yang MASIH berlangsung, skor dihitung saat itu juga —
     * `cbt_answers` belum punya nilai sampai ujian dikumpulkan, jadi tanpa ini
     * layar pengawas selalu menampilkan nol.
     */
    async getAttemptDetails(user: AuthUser, attemptId: string) {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('*, profiles:cbt_profiles(full_name, avatar_url), exams:cbt_exams(*)')
            .eq('id', attemptId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        const attempt = data as any;
        const studentIds = await this.authz.assertExamMonitoring(user, attempt.exam_id);
        if (studentIds !== undefined && !studentIds.includes(attempt.user_id)) {
            throw new ForbiddenException('Peserta tidak berada di ruang dan sesi pengawasan Anda.');
        }

        const [{ data: answerRows, error: answerReadError }, { data: securityLogs }] = await Promise.all([
            this.db
                .from('cbt_answers')
                .select(
                    `*, bank_questions:cbt_bank_questions(
                        *, bank_question_options:cbt_bank_question_options(*)
                     )`,
                )
                .eq('attempt_id', attemptId),
            this.db
                .from('cbt_attempt_security_logs')
                .select('*')
                .eq('attempt_id', attemptId)
                .order('created_at', { ascending: true }),
        ]);

        if (answerReadError) throw new BadRequestException('Jawaban peserta belum dapat dibaca. Coba muat ulang.');

        const questions = await readExamQuestionVersion(this.db, attempt.exam_id);
        const savedAnswers = new Map(((answerRows as any[]) || []).map(answer => [answer.question_id, answer]));
        const answers = questions.map(question => ({
            id: `unanswered:${attemptId}:${question.id}`, attempt_id: attemptId, question_id: question.id,
            selected_option_id: null, essay_answer: null, score: 0, is_correct: null,
            ...(savedAnswers.get(question.id) || {}), bank_questions: question,
        }));

        if (attempt.status === 'in_progress') {
            await this.applyLiveScores(attempt, answers);
        }

        for (const answer of answers) {
            const answered = hasStoredAnswer(answer);
            Object.assign(answer, { is_answered: answered });
            if (!answered) {
                answer.is_correct = null;
                answer.score = 0;
                Object.assign(answer, { needs_manual_grading: false });
            }
        }

        const account = await this.authUsers.findById(attempt.user_id);
        const locations = await loadPasParticipantLocations(this.db, { ...attempt.exams, id: attempt.exam_id }, [attempt.user_id]);

        return {
            canManage: await this.authz.canManageExam(user, attempt.exams),
            attempt: { ...attempt, email: account?.email || '-', pas_location: locations.get(attempt.user_id) || null },
            answers: answers.sort(
                (a, b) =>
                    (a.bank_questions?.order_number ?? Number.MAX_SAFE_INTEGER) -
                    (b.bank_questions?.order_number ?? Number.MAX_SAFE_INTEGER),
            ),
            securityLogs: (securityLogs as any[]) || [],
        };
    }

    /** Nilai sementara untuk pengerjaan yang masih berlangsung. */
    private async applyLiveScores(attempt: any, answers: any[]): Promise<void> {
        try {
            const questions = await loadFrozenExamQuestions(this.db, attempt.exam_id);
            const saved = new Map(answers.map(answer => [answer.question_id, answer]));
            const items = questions.map(question => {
                const answer = saved.get(question.id);
                return {
                    question,
                    answer_id: answer?.id ?? null,
                    raw_answer: answer?.essay_answer ?? answer?.selected_option_id ?? null,
                };
            });
            const result = await this.scoring.post<{
                items: Array<{ answer_id: string | null; score: number; is_correct: boolean | null }>;
                scaled_score: number;
            }>('/grading/attempt', { items });
            const byId = new Map(result.items.map(item => [item.answer_id, item]));
            for (const answer of answers) {
                const scored = byId.get(answer.id);
                if (!scored) continue;
                answer.score = scored.score;
                answer.is_correct = scored.is_correct;
            }
            attempt.total_score = result.scaled_score;
        } catch (err) {
            this.logger.error(`Nilai sementara gagal dihitung untuk pengerjaan ${attempt.id}: ${(err as Error).message}`);
        }
    }

    // ── Tugas (assignment) ───────────────────────────────────────────────────

    /**
     * Seluruh peserta sebuah tugas beserta status pengumpulannya.
     *
     * Peserta dikumpulkan dari dua sumber — kelas sasaran dan peserta
     * perorangan — supaya siswa yang belum mengumpulkan tetap muncul.
     */
    async listAssignmentSubmissions(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const [{ data: exam }, { data: targets }, { data: participants }, { data: attempts }] =
            await Promise.all([
                this.db
                    .from('cbt_exams')
                    .select('id, title, metadata, end_time')
                    .eq('id', examId)
                    .maybeSingle(),
                this.db
                    .from('cbt_exam_targets')
                    .select('class_id, classes:cbt_classes(id, name)')
                    .eq('exam_id', examId),
                this.db.from('cbt_exam_participants').select('user_id').eq('exam_id', examId),
                this.db
                    .from('cbt_exam_attempts')
                    .select(
                        'id, user_id, status, total_score, finished_at, needs_manual_grading, metadata',
                    )
                    .eq('exam_id', examId)
                    .order('finished_at', { ascending: false }),
            ]);

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

        const userIds = new Set(
            ((participants as Array<{ user_id: string }>) || []).map((p) => p.user_id),
        );

        const classIds = ((targets as Array<{ class_id: string | null }>) || [])
            .map((t) => t.class_id)
            .filter((id): id is string => Boolean(id));

        if (classIds.length > 0) {
            const { data: members } = await this.db
                .from('cbt_class_members')
                .select('user_id')
                .in('class_id', classIds);

            for (const member of (members as Array<{ user_id: string }>) || []) {
                userIds.add(member.user_id);
            }
        }

        if (userIds.size === 0) {
            return { exam, submissions: [], classes: [] };
        }

        const { data: profiles } = await this.db
            .from('cbt_profiles')
            .select('id, full_name, identity_number')
            .in('id', [...userIds]);

        // Satu siswa bisa punya lebih dari satu pengerjaan; yang sudah selesai
        // didahulukan supaya kartu pengumpulan tidak menampilkan yang telantar.
        const attemptByUser = new Map<string, any>();
        for (const attempt of (attempts as any[]) || []) {
            const current = attemptByUser.get(attempt.user_id);
            if (!current || (attempt.finished_at && !current.finished_at)) {
                attemptByUser.set(attempt.user_id, attempt);
            }
        }

        const submissions = ((profiles as any[]) || []).map((profile) => {
            const attempt = attemptByUser.get(profile.id);
            const submission = attempt?.metadata?.assignment_submission;

            return {
                userId: profile.id,
                fullName: profile.full_name || 'Tanpa nama',
                identityNumber: profile.identity_number || '-',
                attemptId: attempt?.id || null,
                status: !attempt
                    ? 'belum_mulai'
                    : attempt.status === 'in_progress'
                      ? 'sedang_dikerjakan'
                      : 'sudah_kumpul',
                score: attempt?.total_score ?? null,
                submittedAt: attempt?.finished_at || null,
                needsGrading: attempt?.needs_manual_grading ?? false,
                // Data lama dapat berbentuk apa saja; halaman penilaian hanya menerima larik teks.
                fileUrls: Array.isArray(submission?.fileUrls)
                    ? submission.fileUrls.filter((url: unknown): url is string => typeof url === 'string').slice(0, 50) : [],
                textSubmission: typeof submission?.textSubmission === 'string' ? submission.textSubmission : '',
                teacherFeedback: attempt?.metadata?.teacher_feedback || '',
                teacherScore: attempt?.metadata?.teacher_score ?? null,
            };
        });

        return {
            exam,
            submissions,
            classes: ((targets as any[]) || []).map((t) => t.classes).filter(Boolean),
        };
    }

    async gradeAssignment(
        user: AuthUser,
        attemptId: string,
        score: number,
        feedback: string,
        submittedAt?: string,
    ) {
        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
            throw new BadRequestException('Nilai tugas harus berada antara 0 dan 100.');
        }
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('exam_id, metadata, status, started_at, finished_at')
            .eq('id', attemptId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        const attempt = data as {
            exam_id: string;
            metadata: Record<string, any> | null;
            status: string;
            started_at?: string;
            finished_at?: string;
        };
        const generation = { status: attempt.status, started_at: attempt.started_at, finished_at: attempt.finished_at };

        // Otorisasi lewat ujian induknya: Guru hanya boleh menilai tugas dari
        // ujian buatannya sendiri.
        await this.authz.assertExamStaff(user, attempt.exam_id);

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('exam_type')
            .eq('id', attempt.exam_id)
            .maybeSingle();
        if ((exam as { exam_type?: string } | null)?.exam_type !== 'assignment') {
            throw new BadRequestException('Pengerjaan ini bukan tugas.');
        }
        if (!['submitted', 'auto_submitted'].includes(attempt.status)) {
            throw new BadRequestException('Tugas belum dikumpulkan.');
        }

        if (!submittedAt || submittedAt !== attempt.finished_at) {
            throw new BadRequestException('Pengumpulan tugas berubah. Muat ulang sebelum menilai.');
        }

        await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                .select('status, started_at, finished_at, metadata').eq('id', attemptId).maybeSingle();
            if (readError || !current || current.status !== generation.status ||
                current.started_at !== generation.started_at || current.finished_at !== generation.finished_at) {
                throw new BadRequestException('Pengumpulan tugas berubah. Muat ulang sebelum menilai.');
            }
            const { data: updated, error } = await db
                .from('cbt_exam_attempts')
                .update({
                    total_score: score,
                    needs_manual_grading: false,
                    metadata: {
                        ...(current.metadata || {}),
                        teacher_score: score,
                        teacher_feedback: feedback,
                        graded_at: new Date().toISOString(),
                    },
                })
                .eq('id', attemptId)
                .in('status', ['submitted', 'auto_submitted'])
                .select('id')
                .maybeSingle();

            if (error || !updated) throw new BadRequestException('Nilai tugas gagal disimpan. Coba lagi.');
        });

        return { attemptId, score };
    }
}

/** Tempelkan nama kelas ke peta, menggabungkan bila siswa ada di banyak kelas. */
function appendClassName(target: Map<string, string>, row: any): void {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    if (!cls?.name) return;

    const existing = target.get(row.user_id);
    if (!existing) target.set(row.user_id, cls.name);
    else if (!existing.includes(cls.name)) target.set(row.user_id, `${existing}, ${cls.name}`);
}

/**
 * Rincian pelanggaran per jenis, dihitung SEJAK reset terakhir oleh proktor.
 *
 * Reset dimaksudkan memberi siswa awal yang bersih, jadi peristiwa sebelumnya
 * tidak ikut dihitung — konsisten dengan `warning_count` di ProctoringService.
 */
function summariseViolations(logs: Array<{ event_type: string; created_at: string }>) {
    const lastReset = logs
        .filter((log) => ['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED'].includes(log.event_type))
        .map((log) => log.created_at)
        .sort()
        .pop();

    const breakdown = {
        pindah_tab: 0,
        close_tab: 0,
        keluar_fullscreen: 0,
        shortcut_terlarang: 0,
        salin_tempel: 0,
        klik_kanan: 0,
        lainnya: 0,
    };

    for (const log of logs) {
        if (NON_VIOLATION_EVENTS.includes(log.event_type)) continue;
        if (lastReset && log.created_at <= lastReset) continue;

        if (TAB_SWITCH_EVENTS.includes(log.event_type)) breakdown.pindah_tab++;
        else if (log.event_type === 'tab_close') breakdown.close_tab++;
        else if (log.event_type === 'exit_fullscreen') breakdown.keluar_fullscreen++;
        else if (log.event_type === 'restricted_shortcut') breakdown.shortcut_terlarang++;
        else if (log.event_type === 'copy_paste_attempt') breakdown.salin_tempel++;
        else if (log.event_type === 'right_click_attempt') breakdown.klik_kanan++;
        else breakdown.lainnya++;
    }

    return breakdown;
}
