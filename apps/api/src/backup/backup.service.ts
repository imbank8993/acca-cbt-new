import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { SingleSchoolService } from '../auth/single-school.service';
import { chunk } from '../common/chunk';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';

/** Tanggal untuk penugasan pengawas arsip lama yang belum bertanggal. */
function legacyInvigilatorDates(period: any, schedules: any[]): string[] {
    const day = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
    const dates = new Set<string>(schedules.map(schedule => day(schedule.scheduled_date)).filter(valid));
    const start = day(period?.start_date), end = day(period?.end_date);
    if (valid(start) && valid(end) && start <= end) {
        for (let cursor = new Date(`${start}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= end && dates.size < 400;
            cursor = new Date(cursor.getTime() + 86_400_000)) dates.add(cursor.toISOString().slice(0, 10));
    }
    return [...dates].sort();
}

/** Sisipan dipecah agar satu pernyataan tidak menjadi raksasa. */
const INSERT_BATCH = 500;

/** Batas id per klausa `IN (...)`. */
const ID_BATCH = 500;

export interface BackupPayload {
    version: string;
    timestamp: string;
    organization: { id: string; name: string | null };
    data: Record<string, any[]>;
}

/**
 * Ekspor dan impor seluruh data satu sekolah.
 *
 * Dipindahkan dari `apps/web/app/api/backup/{export,import}/route.ts`. Yang
 * TIDAK ikut pindah adalah pembungkusan ZIP, pengunduhan gambar, dan tanda
 * tangan berkasnya: semua itu urusan berkas, dan tetap dikerjakan route handler
 * Next.js yang memegang kredensial R2.
 *
 * Tiga hal yang diperbaiki saat dipindahkan, ketiganya membuat fitur ini tidak
 * berfungsi sebagaimana namanya:
 *
 *  - IMPOR menulis ke tabel TANPA awalan `cbt_` — `classes`, `subjects`,
 *    `bank_questions`, `exam_attempts`, dan seterusnya. Tabel dengan nama itu
 *    tidak ada, jadi pemulihan selalu gagal pada sisipan pertama. Nama tabel
 *    kini didaftarkan sekali di `TABLES` dan dipakai kedua arah, sehingga ekspor
 *    dan impor tidak bisa lagi menyebut tabel yang berbeda.
 *  - EKSPOR memotong opsi jawaban dan jawaban peserta di 500 baris pertama
 *    (`questionIds.slice(0, 500)`), tanpa peringatan apa pun. Cadangan yang
 *    dihasilkan tampak lengkap padahal tidak. Kini seluruh baris diambil,
 *    dipecah per potongan hanya untuk menjaga ukuran pernyataan SQL.
 *  - Akun yang belum ada dibuat dengan password acak. Itu sudah benar di versi
 *    sebelumnya dan dipertahankan: akun hasil impor wajib melalui atur ulang
 *    password.
 */
@Injectable()
export class BackupService {
    private readonly logger = new Logger(BackupService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly authUsers: AuthUsersRepository,
        private readonly schoolScope: SingleSchoolService,
    ) {}

    /** Pemeriksaan ringan sebelum route Next.js membaca multipart/ZIP. */
    async authorizeImport(user: AuthUser) {
        const { id: organizationId } = await this.schoolScope.getSchool();
        await this.authz.assertProktor(user, organizationId);
        const { data: organization, error } = await this.db
            .from('cbt_organizations')
            .select('id')
            .eq('id', organizationId)
            .maybeSingle();
        if (error || !organization) throw new NotFoundException('Organisasi tidak ditemukan.');
        return { authorized: true as const };
    }

    async export(user: AuthUser): Promise<BackupPayload> {
        const { id: organizationId } = await this.schoolScope.getSchool();
        await this.authz.assertProktor(user, organizationId);

        const { data: org } = await this.db
            .from('cbt_organizations')
            .select('id, name')
            .eq('id', organizationId)
            .maybeSingle();

        if (!org) throw new NotFoundException('Organisasi tidak ditemukan.');

        const [classes, additionalClasses, subjects, categories, banks, exams, attempts, members,
            pasPeriods, organizationLabels] =
            await Promise.all([
                this.byOrganization('cbt_classes', organizationId),
                this.byOrganization('cbt_additional_classes', organizationId),
                this.byOrganization('cbt_subjects', organizationId),
                this.byOrganization('bank_categories', organizationId),
                this.byOrganization('cbt_question_banks', organizationId),
                this.byOrganization('cbt_exams', organizationId),
                this.byOrganization('cbt_exam_attempts', organizationId),
                this.loadMembers(organizationId),
                this.byOrganization('cbt_pas_periods', organizationId),
                this.byOrganization('cbt_organization_labels', organizationId),
            ]);

        const bankIds = banks.map((b) => b.id);
        const examIds = exams.map((e) => e.id);
        const attemptIds = attempts.map((a) => a.id);
        const memberUserIds = members.map((m) => m.user_id).filter(Boolean);
        const periodIds = pasPeriods.map((p) => p.id);

        const [stimuli, instructions, kisiKisi, dimensions, questions, examClasses,
            examTargets, examParticipants, examSources, examQuestionSnapshots, answers, attemptQuestions,
            securityLogs, classMembers, additionalClassMembers, pasSessions,
            pasSchedules, pasRooms] = await Promise.all([
            this.byIds('cbt_question_stimuli', 'bank_id', bankIds),
            this.byIds('cbt_question_instructions', 'bank_id', bankIds),
            this.byIds('cbt_question_kisi_kisi', 'bank_id', bankIds),
            this.byIds('cbt_question_dimensions', 'bank_id', bankIds),
            this.byIds('cbt_bank_questions', 'bank_id', bankIds),
            this.byIds('exam_classes', 'exam_id', examIds),
            this.byIds('cbt_exam_targets', 'exam_id', examIds),
            this.byIds('cbt_exam_participants', 'exam_id', examIds),
            this.byIds('cbt_exam_question_sources', 'exam_id', examIds),
            this.byIds('cbt_exam_question_snapshots', 'exam_id', examIds),
            this.byIds('cbt_answers', 'attempt_id', attemptIds),
            this.byIds('cbt_exam_attempt_questions', 'attempt_id', attemptIds),
            this.byIds('cbt_attempt_security_logs', 'attempt_id', attemptIds),
            this.byIds('cbt_class_members', 'user_id', memberUserIds),
            this.byIds('cbt_additional_class_members', 'user_id', memberUserIds),
            this.byIds('cbt_pas_sessions', 'pas_period_id', periodIds),
            this.byIds('cbt_pas_class_schedules', 'pas_period_id', periodIds),
            this.byIds('cbt_pas_rooms', 'pas_period_id', periodIds),
        ]);

        const options = await this.byIds(
            'cbt_bank_question_options',
            'question_id',
            questions.map((q) => q.id),
        );
        const dimensionInterpretations = await this.byIds(
            'cbt_dimension_interpretations', 'dimension_id', dimensions.map((d) => d.id),
        );
        const roomIds = pasRooms.map((room) => room.id);
        const [roomInvigilators, roomStudents] = await Promise.all([
            this.byIds('cbt_pas_room_invigilators', 'pas_room_id', roomIds),
            this.byIds('cbt_pas_room_students', 'pas_room_id', roomIds),
        ]);

        // Email diambil dari `auth.users`; ia yang menjadi kunci pencocokan saat
        // dipulihkan, karena UUID pengguna tidak dipertahankan antar lingkungan.
        const emails = await this.authUsers.emailMap(memberUserIds);

        const [bankCollaborators, examCollaborators, periodCollaborators, collaborationEvents] = await Promise.all([
            this.byIds('cbt_bank_collaborators', 'bank_id', bankIds),
            this.byIds('cbt_exam_collaborators', 'exam_id', examIds),
            this.byIds('cbt_pas_period_collaborators', 'period_id', periodIds),
            this.byIds('cbt_collaboration_events', 'resource_id', [...bankIds, ...examIds, ...periodIds]),
        ]);
        const knownMembers = new Set(memberUserIds);

        return {
            version: '3.0',
            timestamp: new Date().toISOString(),
            organization: org as { id: string; name: string | null },
            data: {
                users_data: members
                    .map((member) => ({
                        original_user_id: member.user_id,
                        email: emails.get(member.user_id),
                        full_name: member.profiles?.full_name || 'Tanpa nama',
                        identity_number: member.profiles?.identity_number || '-',
                        is_active: member.is_active,
                        role: member.member_roles?.[0]?.roles?.name || 'Siswa',
                        roles: (member.member_roles || [])
                            .map((entry: any) => entry.roles?.name)
                            .filter(Boolean),
                    }))
                    // Tanpa email, akunnya tidak bisa dicocokkan maupun dibuat
                    // ulang saat dipulihkan.
                    .filter((u) => u.email),
                class_members: classMembers,
                additional_classes: additionalClasses,
                additional_class_members: additionalClassMembers,
                classes,
                subjects,
                bank_categories: categories,
                question_banks: banks,
                question_stimuli: stimuli,
                question_instructions: instructions,
                question_kisi_kisi: kisiKisi,
                question_dimensions: dimensions,
                dimension_interpretations: dimensionInterpretations,
                bank_questions: questions,
                bank_question_options: options,
                exams,
                exam_classes: examClasses,
                exam_targets: examTargets,
                exam_participants: examParticipants,
                exam_question_sources: examSources,
                exam_question_snapshots: examQuestionSnapshots,
                exam_attempts: attempts,
                exam_attempt_questions: attemptQuestions,
                attempt_security_logs: securityLogs,
                answers,
                pas_periods: pasPeriods,
                pas_sessions: pasSessions,
                pas_class_schedules: pasSchedules,
                pas_rooms: pasRooms,
                pas_room_invigilators: roomInvigilators,
                pas_room_students: roomStudents,
                organization_labels: organizationLabels,
                bank_collaborators: bankCollaborators.filter(row => knownMembers.has(row.user_id)),
                exam_collaborators: examCollaborators.filter(row => knownMembers.has(row.user_id)),
                period_collaborators: periodCollaborators.filter(row => knownMembers.has(row.user_id)),
                collaboration_events: collaborationEvents,
            },
        };
    }

    /**
     * Pulihkan cadangan ke sebuah organisasi, MENGGANTI seluruh isinya.
     *
     * Data lama dihapus lebih dulu — inilah perilaku yang dijanjikan layar
     * pemulihan ("Ganti seluruh data"), dan menggabungkan dua sumber justru
     * menghasilkan duplikat yang tidak bisa dibedakan.
     *
     * Pemanggilnya sendiri TIDAK ikut dihapus dari keanggotaan: menghapusnya di
     * tengah proses berarti proktor kehilangan aksesnya sebelum pemulihan
     * selesai.
     */
    async import(user: AuthUser, payload: BackupPayload) {
        const { id: organizationId } = await this.schoolScope.getSchool();
        await this.authz.assertProktor(user, organizationId);

        const data = payload?.data;
        if (!data) throw new BadRequestException('Isi berkas cadangan tidak dikenali.');
        this.validatePayload(payload);

        const createdUserIds: string[] = [];
        try {
            // Pembuatan akun auth dapat melibatkan hashing password dan schema
            // terpisah; selesaikan sebelum membuka transaksi data organisasi.
            const userIdMap = await this.prepareUsers(user, data.users_data || [], createdUserIds);
            return await this.db.transaction(async db => {
                await this.wipe(user, organizationId, db);
                await this.restoreMemberships(
                    user, organizationId, data.users_data || [], userIdMap, db,
                );
                const localize = (row: any, forceOrganization = false) => {
                    const copy = { ...row };
                    if (forceOrganization || Object.prototype.hasOwnProperty.call(copy, 'organization_id')) {
                        copy.organization_id = organizationId;
                    }
                    return this.remapUserReferences(copy, userIdMap, user.id);
                };
                const withOrg = (rows: any[]) => (rows || []).map((row) => localize(row, true));
                const withKisiKisi = (rows: any[]) => withOrg(rows).map((row) => {
                    delete row.nomor_kd;
                    delete row.kd_cp;
                    return row;
                });
                const withUser = (rows: any[]) => (rows || [])
                    .filter((row) => userIdMap.has(row.user_id))
                    .map((row) => localize({ ...row, user_id: userIdMap.get(row.user_id) }));
                const plain = (rows: any[]) => (rows || []).map((row) => localize(row));

                await this.insert('cbt_classes', withOrg(data.classes), db);
                await this.insert('cbt_additional_classes', withOrg(data.additional_classes), db);
                await this.insert('cbt_class_members', withUser(data.class_members), db);
                await this.insert('cbt_additional_class_members', withUser(data.additional_class_members), db);
                await this.insert('cbt_subjects', withOrg(data.subjects), db);
                await this.insert('bank_categories', withOrg(data.bank_categories), db);
                await this.insert('cbt_question_banks', withOrg(data.question_banks), db);
                await this.insert('cbt_question_stimuli', withOrg(data.question_stimuli), db);
                await this.insert('cbt_question_instructions', plain(data.question_instructions), db);
                await this.insert('cbt_question_kisi_kisi', withKisiKisi(data.question_kisi_kisi), db);
                await this.insert('cbt_question_dimensions', plain(data.question_dimensions), db);
                await this.insert('cbt_dimension_interpretations', plain(data.dimension_interpretations), db);
                await this.insert('cbt_bank_questions', withOrg(data.bank_questions), db);
                await this.insert('cbt_bank_question_options', plain(data.bank_question_options), db);
                await this.insert('cbt_exams', withOrg(data.exams), db);
                // Akun yang tidak ada di lingkungan tujuan dilewati (seperti anggota kelas),
                // bukan membatalkan seluruh pemulihan karena foreign key profil.
                await this.insert('cbt_bank_collaborators', withUser(data.bank_collaborators), db);
                await this.insert('cbt_exam_collaborators', withUser(data.exam_collaborators), db);
                await this.insert('cbt_collaboration_events', plain(data.collaboration_events), db);
                await this.insert('exam_classes', plain(data.exam_classes), db);
                await this.insert('cbt_exam_targets', plain(data.exam_targets), db);
                await this.insert('cbt_exam_participants', withUser(data.exam_participants), db);
                await this.insert('cbt_exam_question_sources', plain(data.exam_question_sources), db);
                await this.insert('cbt_exam_question_snapshots', plain(data.exam_question_snapshots), db);
                await this.insert('cbt_pas_periods', withOrg(data.pas_periods), db);
                await this.insert('cbt_pas_period_collaborators', withUser(data.period_collaborators), db);
                await this.insert('cbt_pas_sessions', plain(data.pas_sessions), db);
                await this.insert('cbt_pas_rooms', plain(data.pas_rooms), db);
                await this.insert('cbt_pas_class_schedules', plain(data.pas_class_schedules), db);
                const invigilators = withUser(data.pas_room_invigilators).flatMap(row => {
                    if (row.session_id) return [row];
                    const room = (data.pas_rooms || []).find(room => room.id === row.pas_room_id);
                    const sessions = (data.pas_sessions || []).filter(session => session.pas_period_id === room?.pas_period_id);
                    return sessions.length ? sessions.map((session, index) => ({ ...row,
                        id: index === 0 ? row.id : randomUUID(), session_id: session.id })) : [row];
                }).flatMap(row => {
                    // Arsip lama belum mengenal tanggal tugas: salin ke setiap tanggal
                    // folder + tanggal jadwal sesi itu, sama seperti migrasi database.
                    if (!row.session_id || row.exam_date) return [row];
                    const room = (data.pas_rooms || []).find(room => room.id === row.pas_room_id);
                    const period = (data.pas_periods || []).find(period => period.id === room?.pas_period_id);
                    const dates = legacyInvigilatorDates(period, (data.pas_class_schedules || [])
                        .filter(schedule => schedule.pas_period_id === room?.pas_period_id && schedule.session_id === row.session_id));
                    return dates.length ? dates.map((examDate, index) => ({ ...row,
                        id: index === 0 ? row.id : randomUUID(), exam_date: examDate })) : [row];
                });
                await this.insert('cbt_pas_room_invigilators', invigilators, db);
                await this.insert('cbt_pas_room_students', withUser(data.pas_room_students), db);

                const attempts = withOrg(withUser(data.exam_attempts));
                await this.insert('cbt_exam_attempts', attempts, db);
                await this.insert('cbt_exam_attempt_questions', plain(data.exam_attempt_questions), db);
                await this.insert('cbt_attempt_security_logs', plain(data.attempt_security_logs), db);
                await this.insert('cbt_answers', plain(data.answers), db);
                await this.insert('cbt_organization_labels', withOrg(data.organization_labels), db);

                return { organizationId, restoredUsers: userIdMap.size };
            });
        } catch (error) {
            // Akun auth dibuat di schema/service terpisah dari transaksi data
            // organisasi. Lunakkan akun baru bila transaksi utama dibatalkan.
            await Promise.allSettled(createdUserIds.map((id) => this.authUsers.softDeleteUser(id)));
            throw error;
        }
    }

    // ── Pembacaan ────────────────────────────────────────────────────────────

    private validatePayload(payload: BackupPayload): void {
        if (!['1.0', '2.0', '3.0'].includes(payload.version)) {
            throw new BadRequestException(`Versi backup tidak didukung: ${payload.version || 'kosong'}.`);
        }
        if (!payload.organization || typeof payload.organization.id !== 'string') {
            throw new BadRequestException('Identitas organisasi pada backup tidak valid.');
        }

        const data = payload.data as Record<string, unknown>;
        const required = [
            'users_data', 'classes', 'class_members', 'subjects', 'bank_categories',
            'question_banks', 'question_stimuli', 'bank_questions',
            'bank_question_options', 'exams', 'exam_attempts', 'answers',
        ];
        if (payload.version === '3.0') required.push('exam_question_snapshots');
        for (const key of required) {
            if (!Array.isArray(data[key])) {
                throw new BadRequestException(`Bagian backup '${key}' tidak valid atau tidak ada.`);
            }
        }
        for (const [key, value] of Object.entries(data)) {
            if (!Array.isArray(value)) throw new BadRequestException(`Bagian backup '${key}' harus berupa daftar.`);
        }
        const totalRows = Object.values(data).reduce<number>(
            (sum, rows) => sum + (rows as any[]).length,
            0,
        );
        if (totalRows > 500_000) throw new BadRequestException('Jumlah baris backup melewati batas 500.000.');

        const rows = (key: string) => (data[key] as any[] | undefined) || [];
        const ids = (key: string, field = 'id') => new Set(rows(key).map((row) => row?.[field]).filter(Boolean));
        const unique = (key: string, field = 'id') => {
            const values = rows(key).map((row) => row?.[field]).filter(Boolean);
            if (new Set(values).size !== values.length) {
                throw new BadRequestException(`${field} duplikat ditemukan pada '${key}'.`);
            }
        };
        Object.keys(data).forEach((key) => unique(key));
        unique('users_data', 'original_user_id');
        const emails = rows('users_data')
            .map((row) => String(row?.email || '').trim().toLowerCase())
            .filter(Boolean);
        if (new Set(emails).size !== emails.length) {
            throw new BadRequestException("Email duplikat ditemukan pada 'users_data'.");
        }

        const userIds = ids('users_data', 'original_user_id');
        const classIds = ids('classes');
        const additionalClassIds = ids('additional_classes');
        const bankIds = ids('question_banks');
        const questionIds = ids('bank_questions');
        const dimensionIds = ids('question_dimensions');
        const examIds = ids('exams');
        const attemptIds = ids('exam_attempts');
        const periodIds = ids('pas_periods');
        const sessionIds = ids('pas_sessions');
        const roomIds = ids('pas_rooms');

        const references: Array<[string, string, Set<unknown>, boolean?]> = [
            ['class_members', 'class_id', classIds], ['class_members', 'user_id', userIds],
            ['additional_class_members', 'class_id', additionalClassIds],
            ['additional_class_members', 'user_id', userIds],
            ['question_stimuli', 'bank_id', bankIds], ['question_instructions', 'bank_id', bankIds],
            ['question_kisi_kisi', 'bank_id', bankIds], ['question_dimensions', 'bank_id', bankIds],
            ['dimension_interpretations', 'dimension_id', dimensionIds],
            ['bank_questions', 'bank_id', bankIds],
            ['bank_question_options', 'question_id', questionIds],
            ['exams', 'question_bank_id', bankIds, true],
            ['exam_classes', 'exam_id', examIds], ['exam_targets', 'exam_id', examIds],
            ['exam_participants', 'exam_id', examIds], ['exam_participants', 'user_id', userIds],
            ['exam_question_sources', 'exam_id', examIds],
            ['exam_question_sources', 'bank_id', bankIds],
            ['bank_collaborators', 'bank_id', bankIds], ['bank_collaborators', 'user_id', userIds],
            ['period_collaborators', 'period_id', periodIds], ['period_collaborators', 'user_id', userIds],
            ['exam_collaborators', 'exam_id', examIds], ['exam_collaborators', 'user_id', userIds],
            ['exam_question_snapshots', 'exam_id', examIds],
            ['exam_question_snapshots', 'question_id', questionIds, true],
            ['exam_attempts', 'exam_id', examIds], ['exam_attempts', 'user_id', userIds],
            ['exam_attempt_questions', 'attempt_id', attemptIds],
            ['exam_attempt_questions', 'question_id', questionIds],
            ['attempt_security_logs', 'attempt_id', attemptIds], ['answers', 'attempt_id', attemptIds],
            ['answers', 'question_id', questionIds],
            ['pas_sessions', 'pas_period_id', periodIds], ['pas_rooms', 'pas_period_id', periodIds],
            ['pas_class_schedules', 'pas_period_id', periodIds],
            ['pas_class_schedules', 'session_id', sessionIds],
            ['pas_class_schedules', 'bank_id', bankIds],
            ['pas_class_schedules', 'class_id', classIds],
            ['pas_room_invigilators', 'pas_room_id', roomIds],
            ['pas_room_invigilators', 'user_id', userIds],
            ['pas_room_invigilators', 'session_id', sessionIds, true],
            ['pas_room_students', 'pas_room_id', roomIds], ['pas_room_students', 'user_id', userIds],
        ];
        for (const [table, field, valid, nullable] of references) {
            for (const row of rows(table)) {
                const value = row?.[field];
                if (nullable && (value === null || value === undefined || value === '')) continue;
                if (!valid.has(value)) {
                    throw new BadRequestException(`Referensi ${table}.${field} tidak valid.`);
                }
            }
        }
        for (const table of ['bank_collaborators', 'exam_collaborators', 'period_collaborators']) {
            for (const row of rows(table)) {
                if (!['viewer', 'editor', 'manager'].includes(row.permission) ||
                    row.expires_at && !Number.isFinite(Date.parse(row.expires_at)) ||
                    row.revoked_at && !Number.isFinite(Date.parse(row.revoked_at)) ||
                    table === 'exam_collaborators' && (typeof row.can_reset !== 'boolean' || row.permission === 'viewer' && row.can_reset)) {
                    throw new BadRequestException('Izin kolaborator dalam backup tidak valid.');
                }
            }
        }
        for (const assignment of rows('pas_room_invigilators')) {
            if (!assignment.session_id) continue;
            const room = rows('pas_rooms').find(row => row.id === assignment.pas_room_id);
            const session = rows('pas_sessions').find(row => row.id === assignment.session_id);
            if (!room || !session || room.pas_period_id !== session.pas_period_id) {
                throw new BadRequestException('Ruang dan sesi pengawas dalam arsip harus berasal dari periode yang sama.');
            }
        }
        for (const target of rows('exam_targets')) {
            const validClass = target.class_id && classIds.has(target.class_id);
            const validAdditional = target.additional_class_id && additionalClassIds.has(target.additional_class_id);
            if (!validClass && !validAdditional) {
                throw new BadRequestException('Target ujian tidak merujuk kelas yang valid.');
            }
        }
    }

    private remapUserReferences(
        row: Record<string, any>,
        mapping: Map<string, string>,
        fallbackUserId: string,
    ): Record<string, any> {
        for (const field of ['user_id', 'created_by', 'updated_by', 'teacher_id', 'proctor_id', 'granted_by', 'actor_id']) {
            if (!row[field]) continue;
            if (mapping.has(row[field])) row[field] = mapping.get(row[field]);
            else if (field !== 'user_id') row[field] = fallbackUserId;
        }
        return row;
    }

    private async byOrganization(table: string, organizationId: string): Promise<any[]> {
        const { data, error } = await this.db
            .from(table)
            .select('*')
            .eq('organization_id', organizationId);

        if (error) {
            this.logger.error(`Gagal membaca ${table}: ${error.message}`);
            throw new BadRequestException(`Gagal membaca ${table}: ${error.message}`);
        }
        return (data as any[]) || [];
    }

    /** Seluruh baris yang kolomnya cocok dengan salah satu id — tanpa dipotong. */
    private async byIds(table: string, column: string, ids: string[]): Promise<any[]> {
        if (ids.length === 0) return [];

        const rows: any[] = [];
        for (const batch of chunk([...new Set(ids)], ID_BATCH)) {
            const { data, error } = await this.db.from(table).select('*').in(column, batch);
            if (error) {
                this.logger.error(`Gagal membaca ${table}: ${error.message}`);
                throw new BadRequestException(`Gagal membaca ${table}: ${error.message}`);
            }
            rows.push(...((data as any[]) || []));
        }
        return rows;
    }

    private async loadMembers(organizationId: string): Promise<any[]> {
        const { data, error } = await this.db
            .from('cbt_organization_members')
            .select(
                `id, user_id, is_active,
                 profiles:cbt_profiles(full_name, identity_number),
                 member_roles:cbt_member_roles(roles:cbt_roles(name))`,
            )
            .eq('organization_id', organizationId);

        if (error) throw new BadRequestException(`Gagal membaca anggota: ${error.message}`);

        return (data as any[]) || [];
    }

    // ── Penulisan ────────────────────────────────────────────────────────────

    private async wipe(user: AuthUser, organizationId: string, db: DbSession): Promise<void> {
        // Urutannya mengikuti arah foreign key: anak lebih dulu. Sebagian memang
        // ikut terhapus lewat CASCADE, tetapi menyebutkannya eksplisit membuat
        // urutan ini tidak bergantung pada definisi relasi yang bisa berubah.
        const auditDelete = await db.from('cbt_collaboration_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (auditDelete.error) throw new BadRequestException('Riwayat kolaborasi belum dapat dipulihkan.');
        for (const table of [
            'cbt_exam_attempts',
            'cbt_pas_periods',
            'cbt_exams',
            'cbt_question_banks',
            'bank_categories',
            'cbt_subjects',
            'cbt_additional_classes',
            'cbt_classes',
            'cbt_organization_labels',
        ]) {
            const { error } = await db.from(table).delete().eq('organization_id', organizationId);
            if (error) throw new BadRequestException(`Gagal membersihkan ${table}: ${error.message}`);
        }

        // Keanggotaan pemanggil dipertahankan supaya ia tidak kehilangan akses
        // di tengah pemulihan.
        const { error } = await db
            .from('cbt_organization_members')
            .delete()
            .eq('organization_id', organizationId)
            .neq('user_id', user.id);
        if (error) throw new BadRequestException(`Gagal membersihkan anggota: ${error.message}`);
    }

    /**
     * Cocokkan atau buat akun untuk tiap pengguna di cadangan, dan kembalikan
     * peta id lama → id baru.
     *
     * Pencocokannya lewat EMAIL: UUID pengguna tidak dipertahankan antar
     * lingkungan, jadi id di berkas cadangan tidak berarti apa-apa di sini.
     */
    private async prepareUsers(
        caller: AuthUser,
        users: any[],
        createdUserIds: string[],
    ): Promise<Map<string, string>> {
        const mapping = new Map<string, string>();
        if (users.length === 0) return mapping;

        const existing = await this.authUsers.listUsers({});
        const idByEmail = new Map<string, string>(
            existing
                .filter((u) => u.email)
                .map((u) => [(u.email as string).toLowerCase(), u.id]),
        );

        for (const entry of users) {
            const email = String(entry.email || '').toLowerCase();
            if (!email) continue;

            try {
                let userId = idByEmail.get(email);

                if (userId === caller.id) {
                    mapping.set(entry.original_user_id, caller.id);
                    continue;
                }

                if (!userId) {
                    const created = await this.authUsers.createUser({
                        email,
                        // Password acak per akun. Akun hasil impor WAJIB melalui
                        // atur ulang password; password bersama yang tertulis di
                        // kode akan membuka seluruh akun peserta sekaligus.
                        password: randomUUID(),
                        userMetadata: {
                            full_name: entry.full_name || email.split('@')[0],
                            role: entry.role || 'Siswa',
                        },
                    });
                    userId = created.id;
                    createdUserIds.push(userId);
                    idByEmail.set(email, userId);
                }

                mapping.set(entry.original_user_id, userId);
            } catch (err) {
                this.logger.warn(`Gagal memulihkan pengguna ${email}: ${(err as Error).message}`);
                throw new BadRequestException(`Gagal memulihkan pengguna ${email}.`);
            }
        }

        return mapping;
    }

    private async restoreMemberships(
        caller: AuthUser,
        organizationId: string,
        users: any[],
        mapping: Map<string, string>,
        db: DbSession,
    ): Promise<void> {
        if (users.length === 0) return;
        const { data: roleRows, error: rolesError } = await db.from('cbt_roles').select('id, name');
        if (rolesError) throw new BadRequestException(`Daftar peran gagal dibaca: ${rolesError.message}`);
        const roleIdByName = new Map<string, string>(
            ((roleRows as Array<{ id: string; name: string }>) || []).map((r) => [r.name, r.id]),
        );

        for (const entry of users) {
            const email = String(entry.email || '').toLowerCase();
            const userId = mapping.get(entry.original_user_id);
            if (!userId) throw new BadRequestException(`Pengguna ${email || entry.original_user_id} tidak dapat dipetakan.`);
            // Keanggotaan operator sengaja dipertahankan oleh wipe.
            if (userId === caller.id) continue;

            const { error: profileError } = await db.from('cbt_profiles').upsert({
                id: userId,
                full_name: entry.full_name || email.split('@')[0],
                identity_number: entry.identity_number || '-',
            }, { onConflict: 'id' });
            if (profileError) throw new BadRequestException(`Profil ${email} gagal disimpan.`);

            const { data: member, error: memberError } = await db
                .from('cbt_organization_members')
                .insert({ organization_id: organizationId, user_id: userId, is_active: entry.is_active ?? true })
                .select('id')
                .maybeSingle();
            if (memberError || !member) throw new BadRequestException(`Keanggotaan ${email} gagal disimpan.`);

            const roles = Array.isArray(entry.roles) && entry.roles.length > 0
                ? entry.roles : [entry.role || 'Siswa'];
            for (const roleName of [...new Set<string>((roles as unknown[]).map(String))]) {
                const roleId = roleIdByName.get(roleName);
                if (!roleId) throw new BadRequestException(`Peran '${roleName}' tidak tersedia.`);
                const { error } = await db.from('cbt_member_roles').insert({
                    organization_member_id: (member as { id: string }).id,
                    role_id: roleId,
                });
                if (error) throw new BadRequestException(`Peran ${email} gagal disimpan.`);
            }
        }
    }

    private async insert(table: string, rows: any[], db: DbSession): Promise<void> {
        if (!rows || rows.length === 0) return;

        for (const batch of chunk(rows, INSERT_BATCH)) {
            const { error } = await db.from(table).insert(batch);
            if (error) {
                throw new BadRequestException(
                    `Gagal memulihkan tabel ${table}: ${error.message}`,
                );
            }
        }
    }
}
