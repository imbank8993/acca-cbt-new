import { clientContextChange, validateSyncHealth, type ClientSyncHealth } from '../common/exam-monitoring';
import { examDeadline } from '../common/exam-deadline';
import { hasCommittedSubmitIntent } from '../common/submission-commitment';
import { STUDENT_SECURITY_EVENTS, securityEventCounters, validateStudentSecurityMetadata } from '../common/student-security-events';
export { STUDENT_SECURITY_EVENTS } from '../common/student-security-events';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { GradingService } from '../grading/grading.service';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';

/** Status attempt yang boleh di-reset proktor. */
const RESETTABLE_STATUSES = ['auto_submitted', 'submitted'];

@Injectable()
export class ProctoringService {
    private readonly logger = new Logger(ProctoringService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly grading: GradingService,
    ) {}

    /**
     * Catat pelanggaran keamanan selama ujian berlangsung.
     *
     * Hanya pemilik attempt yang boleh melaporkan pelanggarannya sendiri, dan
     * HANYA selama attempt masih berjalan. Tanpa penjaga status, event yang
     * terpicu saat proses terminasi (mis. keluar fullscreen ketika halaman
     * di-reload) tetap tercatat dan membuat `warning_count` melampaui batas.
     */
    async logViolation(
        user: AuthUser,
        attemptId: string,
        eventType: string,
        metadata: Record<string, unknown> = {},
        clientEventId?: string,
    ) {
        if (!STUDENT_SECURITY_EVENTS.includes(eventType)) {
            throw new BadRequestException('Jenis event siswa tidak diizinkan.');
        }
        validateStudentSecurityMetadata(metadata);
        const result = await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: attempt } = await db
                .from('cbt_exam_attempts')
                .select('user_id, status, exam_id, warning_count, metadata')
                .eq('id', attemptId)
                .maybeSingle();

            if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
            const row = attempt as {
                user_id: string;
                status: string;
                exam_id: string;
                warning_count: number | null;
                metadata?: Record<string, unknown> | null;
            };

            if (row.user_id !== user.id) {
                throw new ForbiddenException('Tidak diizinkan.');
            }
            let duplicate = false;
            if (clientEventId) {
                const { data: existing } = await db
                    .from('cbt_attempt_security_logs')
                    .select('id, event_type, metadata')
                    .eq('attempt_id', attemptId)
                    .contains('metadata', { client_event_id: clientEventId })
                    .maybeSingle();
                if (existing && (existing.event_type !== eventType || existing.metadata?.source !== 'student' ||
                    existing.metadata?.actor_id !== user.id)) throw new BadRequestException('ID catatan pengawasan tidak cocok.');
                duplicate = Boolean(existing);
            }

            const { data: exam } = await db
                .from('cbt_exams')
                .select('metadata')
                .eq('id', row.exam_id)
                .maybeSingle();
            const examMetadata = (exam as { metadata?: Record<string, unknown> } | null)?.metadata || {};
            const safeMode = examMetadata.is_safe_mode !== false;
            const configuredLimit = examMetadata.max_violations;
            const maxViolations = !safeMode || configuredLimit === null
                ? null
                : (Number.isInteger(configuredLimit) && Number(configuredLimit) >= 1
                    ? Number(configuredLimit)
                    : 3);

            // Respons terminasi bisa hilang ketika jaringan putus tepat setelah
            // server menutup attempt. Retry event yang sama harus tetap berhasil
            // agar antrean perangkat dapat dibersihkan secara idempoten.
            if (row.status !== 'in_progress') {
                if (duplicate) {
                    return {
                        warningCount: row.warning_count || 0,
                        duplicate: true,
                        maxViolations,
                        terminated: row.status === 'auto_submitted',
                        shouldTerminate: false,
                    };
                }
                throw new BadRequestException('Ujian tidak sedang berlangsung.');
            }

            if (!duplicate) {
                const { error: insertError } = await db
                    .from('cbt_attempt_security_logs')
                    .insert({ attempt_id: attemptId, event_type: eventType,
                        metadata: {
                            ...metadata,
                            ...(clientEventId ? { client_event_id: clientEventId } : {}),
                            actor_id: user.id,
                            source: 'student',
                        } });
                if (insertError) {
                    const { data: winner } = clientEventId
                        ? await db.from('cbt_attempt_security_logs')
                            .select('id')
                            .eq('attempt_id', attemptId)
                            .contains('metadata', { client_event_id: clientEventId })
                            .maybeSingle()
                        : { data: null };
                    if (!winner) throw new BadRequestException('Log pengawasan belum dapat disimpan.');
                    duplicate = true;
                }
            }

            // Penghitung diturunkan dengan MENGHITUNG baris log, bukan dengan
            // baca-ubah-tulis. Increment kehilangan kenaikan yang bersamaan ketika
            // beberapa event terpicu berdekatan.
            const updates = await securityEventCounters(db, attemptId);
            const { error: updateError } = await db
                .from('cbt_exam_attempts').update(updates).eq('id', attemptId).eq('status', 'in_progress');
            if (updateError) throw new BadRequestException('Penghitung pengawasan belum dapat diperbarui.');

            const authoritativeCount = updates.warning_count;
            const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            const mustTerminate = maxViolations !== null && authoritativeCount >= maxViolations &&
                !hasCommittedSubmitIntent(row.metadata, new Date(clock.now));
            return {
                warningCount: authoritativeCount,
                duplicate,
                maxViolations,
                terminated: false,
                shouldTerminate: mustTerminate,
            };
        });
        const { shouldTerminate, ...response } = result;
        if (shouldTerminate) {
            response.terminated = await this.forceTerminate(user, attemptId,
                `Batas ${result.maxViolations} pelanggaran tercapai (${result.warningCount}); event terakhir: ${eventType}.`, true);
        }
        return response;
    }

    /** Heartbeat terautentikasi untuk membedakan peserta online dan offline. */
    async heartbeat(user: AuthUser, attemptId: string, deviceId: string, syncHealth?: ClientSyncHealth,
        clientContext?: { browser: string | null; os: string | null; ip_address: string | null }, screenSharing?: boolean) {
        let health: ClientSyncHealth | undefined;
        try { health = validateSyncHealth(syncHealth); }
        catch { throw new BadRequestException('Laporan penyimpanan tidak valid.'); }
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: attempt, error: readError } = await db.from('cbt_exam_attempts')
                .select('user_id, status, device_fingerprint, last_seen_at, metadata, exam_id, started_at, personal_end_time').eq('id', attemptId).maybeSingle();
            if (readError) throw new BadRequestException('Status koneksi belum dapat dibaca.');
            if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
            if (attempt.user_id !== user.id) throw new ForbiddenException('Tidak diizinkan.');
            if (attempt.status !== 'in_progress') throw new BadRequestException('Ujian tidak sedang berlangsung.');
            if (!deviceId || (attempt.device_fingerprint && attempt.device_fingerprint !== deviceId)) {
                throw new ForbiddenException('Perangkat tidak cocok dengan sesi ujian.');
            }
            const now = await this.databaseNow(db);
            const metadata = { ...(attempt.metadata || {}) };
            const previousContext = metadata.client_context;
            if (clientContext) metadata.client_context = { ...clientContext, observed_at: now.toISOString() };
            const previous = metadata.sync_health;
            const lastSeen = Date.parse(attempt.last_seen_at || '');
            const log = async (event_type: string, details: Record<string, unknown>) => {
                const { error } = await db.from('cbt_attempt_security_logs').insert({
                    attempt_id: attemptId, event_type, created_at: now.toISOString(),
                    metadata: { ...details, source: 'server_monitoring', actor_user_id: user.id },
                });
                if (error) throw new BadRequestException('Riwayat koneksi belum tersimpan.');
            };
            if (Number.isFinite(lastSeen) && now.getTime() - lastSeen > 45_000) {
                const { data: exam, error: examError } = await db.from('cbt_exams')
                    .select('end_time, duration_minutes').eq('id', attempt.exam_id).maybeSingle();
                if (examError) throw new BadRequestException('Batas waktu ujian belum dapat dibaca.');
                const deadline = exam ? examDeadline(attempt, exam).getTime() : NaN;
                await log('CONNECTION_GAP_DETECTED', { last_seen_at: attempt.last_seen_at,
                    observed_again_at: now.toISOString(), gap_seconds: Math.floor((now.getTime() - lastSeen) / 1000),
                    evidence: 'server_observation',
                    remaining_at_last_seen_seconds: Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - lastSeen) / 1000)) : null,
                    remaining_at_reconnect_seconds: Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now.getTime()) / 1000)) : null,
                });
            }
            const contextChange = clientContext ? clientContextChange(previousContext, clientContext) : null;
            if (contextChange) {
                await log('CLIENT_CONTEXT_CHANGED', { ...contextChange, evidence: 'server_observation',
                    note: contextChange.fields.length === 1 && contextChange.fields[0] === 'ip_address'
                        ? 'Hanya IP yang berubah; wajar pada jaringan seluler atau pindah Wi-Fi.'
                        : 'Browser/OS berubah dalam satu sesi: periksa kemungkinan perangkat lain memakai sesi ini.' });
            }
            if (typeof screenSharing === 'boolean') {
                const { data: examRow, error: examRowError } = await db.from('cbt_exams')
                    .select('metadata').eq('id', attempt.exam_id).maybeSingle();
                if (examRowError) throw new BadRequestException('Pengaturan ujian belum dapat dibaca.');
                const required = examRow?.metadata?.screenshot_enabled === true;
                // Dicatat sekali per perubahan, bukan setiap 15 detik.
                if (required && !screenSharing && metadata.screen_share_confirmed !== false) {
                    const { data: exception } = await db.from('cbt_exam_screen_share_exceptions')
                        .select('user_id').eq('exam_id', attempt.exam_id).eq('user_id', user.id).maybeSingle();
                    if (!exception) await log('SCREEN_SHARE_UNCONFIRMED', { evidence: 'client_report', reported_at: now.toISOString() });
                }
                if (required) metadata.screen_share_confirmed = screenSharing;
            }
            if (health?.interruption && metadata.last_connection_report_at !== health.interruption.at) {
                await log('CONNECTION_INTERRUPTION_REPORTED', {
                    evidence: 'client_report', disconnected_at: health.interruption.at,
                    remaining_at_disconnect_seconds: health.interruption.remainingSeconds,
                    reason: health.interruption.reason, received_at: now.toISOString(),
                });
                metadata.last_connection_report_at = health.interruption.at;
            }
            if (health) {
                const changed = !previous || previous.storageState !== health.storageState ||
                    Boolean(previous.pendingAnswerCount) !== Boolean(health.pendingAnswerCount);
                if (changed) await log('SYNC_HEALTH_CHANGED', { ...health, evidence: 'client_report' });
                metadata.sync_health = { ...health, receivedAt: now.toISOString() };
            }
            const { error } = await db.from('cbt_exam_attempts')
                .update({ last_seen_at: now.toISOString(), metadata }).eq('id', attemptId).eq('status', 'in_progress');
            if (error) throw new BadRequestException('Status koneksi belum dapat diperbarui.');
            return { lastSeenAt: now.toISOString(), submissionOnly: metadata.recovery_submit_only === true };
        });
    }

    /**
     * Kembalikan attempt yang sudah tertutup ke `in_progress` dengan jawaban utuh.
     *
     * Berlaku untuk attempt yang DITUTUP SISTEM maupun yang SUDAH DISUBMIT siswa
     * Pengumpulan hanya menerima salinan jawaban lama; untuk mengerjakan ulang gunakan susulan. Attempt yang masih
     * berjalan tidak perlu — dan tidak boleh — di-reset.
     */
    async resetAttempt(user: AuthUser, attemptId: string, reason: string, durationMinutes: number) {
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 5 || normalizedReason.length > 500) {
            throw new BadRequestException('Alasan pemulihan wajib diisi (5–500 karakter).');
        }
        if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
            throw new BadRequestException('Waktu pemulihan harus 1–1440 menit.');
        }

        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('id, exam_id, user_id')
            .eq('id', attemptId)
            .maybeSingle();

        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        // Pembuat ujian dan Admin; khusus PAS, Proktor serta pengawas ruang yang ditugaskan.
        // Tanpa ini siswa bisa membatalkan terminasi attempt-nya sendiri.
        await this.authz.assertExamStaff(user, (attempt as { exam_id: string }).exam_id, 'reset', (attempt as { user_id: string }).user_id);

        return this.db.transaction(async db => {
            await db.raw(
                'SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE',
                attemptId,
            );

            const { data: locked, error: readError } = await db
                .from('cbt_exam_attempts')
                .select('id, exam_id, status, personal_end_time, metadata')
                .eq('id', attemptId)
                .maybeSingle();
            if (readError || !locked) {
                throw new NotFoundException('Pengerjaan tidak ditemukan.');
            }
            const row = locked as {
                status: string;
                personal_end_time: string | null;
                metadata: Record<string, unknown> | null;
            };

            if (!RESETTABLE_STATUSES.includes(row.status)) {
                throw new BadRequestException(
                    'Hanya ujian yang sudah selesai (submit / ditutup sistem) yang bisa di-reset.',
                );
            }

            // Salin nilai sebelum UPDATE. Selain membuat audit eksplisit, ini
            // mencegah adapter/fixture yang mengembalikan referensi mutable
            // mengubah "status sebelumnya" menjadi `in_progress`.
            const previousStatus = row.status;
            const previousDeadline = row.personal_end_time;
            const previousMetadata = { ...(row.metadata || {}) };

            const now = await this.databaseNow(db);
            const { count: serverAnswerCount, error: countError } = await db
                .from('cbt_answers')
                .select('id', { count: 'exact', head: true })
                .eq('attempt_id', attemptId);
            if (countError) {
                throw new BadRequestException('Jumlah jawaban server belum dapat diperiksa.');
            }

            const updates: Record<string, unknown> = {
                status: 'in_progress',
                finished_at: null,
                total_score: null,
                score_irt: null,
                detailed_scores: null,
                irt_theta: null,
                needs_manual_grading: false,
                warning_count: 0,
                tab_switch_count: 0,
            };

            const recoveryUntil = new Date(
                now.getTime() + durationMinutes * 60 * 1000,
            ).toISOString();
            const metadataWithoutOldScore = { ...previousMetadata };
            delete metadataWithoutOldScore.teacher_score;
            delete metadataWithoutOldScore.teacher_feedback;
            delete metadataWithoutOldScore.graded_at;
            delete metadataWithoutOldScore.grading_retry_next_at;
            delete metadataWithoutOldScore.relative_scoring_pending;
            delete metadataWithoutOldScore.base_score;
            delete metadataWithoutOldScore.dimension_scores;
            delete metadataWithoutOldScore.sync_health;
            delete metadataWithoutOldScore.submit_intent_at;
            updates.personal_end_time = recoveryUntil;
            updates.metadata = {
                ...metadataWithoutOldScore,
                proctor_recovery_until: recoveryUntil,
                recovery_submit_only: true,
                recovery_source_deadline: previousMetadata.recovery_source_deadline || previousDeadline,
            };

            const { error: updateError } = await db
                .from('cbt_exam_attempts')
                .update(updates)
                .eq('id', attemptId)
                .eq('status', previousStatus);
            if (updateError) {
                throw new BadRequestException('Status pemulihan belum dapat disimpan.');
            }

            const { error: logError } = await db.from('cbt_attempt_security_logs').insert({
                attempt_id: attemptId,
                event_type: 'RESET_BY_PROCTOR',
                metadata: {
                    reset_at: now.toISOString(),
                    actor_user_id: user.id,
                    reason: normalizedReason,
                    previous_status: previousStatus,
                    previous_deadline: previousDeadline,
                    recovery_until: recoveryUntil,
                    recovery_duration_minutes: durationMinutes,
                    server_answer_count: serverAnswerCount || 0,
                },
            });
            if (logError) {
                throw new BadRequestException('Jejak audit pemulihan belum dapat disimpan.');
            }

            return {
                attemptId,
                previousStatus,
                recoveryUntil,
                serverAnswerCount: serverAnswerCount || 0,
            };
        });
    }

    /**
     * Buka ujian susulan dari awal untuk satu siswa.
     *
     * Berbeda dari reset/pemulihan: seluruh jawaban lama dihapus di transaksi
     * yang sama. Attempt yang sama dipakai agar hasil submit berikutnya tetap
     * muncul di ujian, kelas, analisis, dan rekap yang sama.
     */
    async startMakeupAttempt(
        user: AuthUser,
        attemptId: string,
        reason: string,
        durationMinutes: number,
        clientRequestId?: string,
    ) {
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 5 || normalizedReason.length > 500) {
            throw new BadRequestException('Alasan ujian susulan wajib diisi (5–500 karakter).');
        }
        if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
            throw new BadRequestException('Waktu ujian susulan harus 1–1440 menit.');
        }

        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('id, exam_id, user_id')
            .eq('id', attemptId)
            .maybeSingle();
        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        await this.authz.assertExamStaff(user, (attempt as { exam_id: string }).exam_id, 'reset', (attempt as { user_id: string }).user_id);

        return this.db.transaction(async db => {
            await db.raw(
                'SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE',
                attemptId,
            );
            // Susulan mengulang dari awal. Bila kunci jawaban sudah pernah dapat
            // dibuka siswa, mengulang berarti mengerjakan dengan kunci di tangan.
            const { data: exam, error: examError } = await db.from('cbt_exams')
                .select('show_results, end_time, metadata').eq('id', (attempt as { exam_id: string }).exam_id).maybeSingle();
            if (examError || !exam) throw new BadRequestException('Pengaturan ujian belum dapat diperiksa.');
            const [releaseClock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            const endMs = Date.parse(exam.end_time || '');
            if (exam.show_results === true && exam.metadata?.show_answer_keys === true &&
                Number.isFinite(endMs) && new Date(releaseClock.now).getTime() >= endMs) {
                throw new BadRequestException('Kunci jawaban ujian ini sudah dibuka untuk siswa. Tutup kunci jawaban ' +
                    'terlebih dahulu, atau gunakan ujian/paket soal lain untuk susulan.');
            }
            const { data: locked } = await db
                .from('cbt_exam_attempts')
                .select('id, status, personal_end_time, metadata')
                .eq('id', attemptId)
                .maybeSingle();
            if (!locked) throw new NotFoundException('Pengerjaan tidak ditemukan.');
            const row = locked as {
                status: string;
                personal_end_time: string | null;
                metadata: Record<string, unknown> | null;
            };

            // Respons POST dapat hilang saat jaringan putus sesudah transaksi
            // berhasil. Percobaan ulang dengan kunci yang sama harus mengembalikan
            // hasil pertama dan tidak pernah menyentuh jawaban baru siswa.
            if (clientRequestId) {
                const { data: previousRun } = await db
                    .from('cbt_attempt_security_logs')
                    .select('metadata')
                    .eq('attempt_id', attemptId)
                    .eq('event_type', 'MAKEUP_EXAM_STARTED')
                    .contains('metadata', { client_request_id: clientRequestId })
                    .maybeSingle();
                const metadata = (previousRun as { metadata?: Record<string, unknown> } | null)?.metadata;
                if (metadata) {
                    return {
                        attemptId,
                        previousStatus: String(metadata.previous_status || 'submitted'),
                        recoveryUntil: String(metadata.recovery_until),
                        durationMinutes: Number(metadata.duration_minutes),
                        deletedAnswerCount: Number(metadata.deleted_answer_count || 0),
                    };
                }
            }
            if (!RESETTABLE_STATUSES.includes(row.status)) {
                throw new BadRequestException(
                    'Ujian susulan hanya dapat dibuat dari pengerjaan yang sudah selesai.',
                );
            }

            const now = await this.databaseNow(db);
            const recoveryUntil = new Date(
                now.getTime() + durationMinutes * 60 * 1000,
            ).toISOString();
            const previousStatus = row.status;
            const previousDeadline = row.personal_end_time;
            const previousMetadata = { ...(row.metadata || {}) };
            delete previousMetadata.scoring_finished_at;
            delete previousMetadata.grading_retry_next_at;
            delete previousMetadata.teacher_score;
            delete previousMetadata.teacher_feedback;
            delete previousMetadata.graded_at;
            delete previousMetadata.relative_scoring_pending;
            delete previousMetadata.base_score;
            delete previousMetadata.dimension_scores;
            delete previousMetadata.grading_retry_count;
            delete previousMetadata.grading_retry_at;
            delete previousMetadata.grading_retry_error;
            delete previousMetadata.grading_recovered_at;
            delete previousMetadata.sync_health;
            delete previousMetadata.submit_intent_at;
            delete previousMetadata.recovery_submit_only;
            delete previousMetadata.recovery_source_deadline;
            delete previousMetadata.closed_by_expiry;
            delete previousMetadata.frozen_submission_received_at;

            const { count: deletedAnswerCount, error: countError } = await db
                .from('cbt_answers')
                .select('id', { count: 'exact', head: true })
                .eq('attempt_id', attemptId);
            if (countError) {
                throw new BadRequestException('Jawaban lama belum dapat dihitung.');
            }
            const { error: deleteError } = await db
                .from('cbt_answers')
                .delete()
                .eq('attempt_id', attemptId);
            if (deleteError) {
                throw new BadRequestException('Jawaban lama belum dapat dihapus.');
            }

            const { error: updateError } = await db
                .from('cbt_exam_attempts')
                .update({
                    status: 'in_progress',
                    started_at: now.toISOString(),
                    finished_at: null,
                    personal_end_time: recoveryUntil,
                    total_score: null,
                    score_irt: null,
                    detailed_scores: null,
                    irt_theta: null,
                    needs_manual_grading: false,
                    warning_count: 0,
                    tab_switch_count: 0,
                    device_fingerprint: null,
                    metadata: {
                        ...previousMetadata,
                        proctor_recovery_until: recoveryUntil,
                        makeup_exam: true,
                        makeup_duration_minutes: durationMinutes,
                        makeup_activated_at: now.toISOString(),
                    },
                })
                .eq('id', attemptId)
                .eq('status', previousStatus);
            if (updateError) {
                throw new BadRequestException('Ujian susulan belum dapat diaktifkan.');
            }

            const { error: logError } = await db.from('cbt_attempt_security_logs').insert({
                attempt_id: attemptId,
                event_type: 'MAKEUP_EXAM_STARTED',
                metadata: {
                    actor_user_id: user.id,
                    reason: normalizedReason,
                    previous_status: previousStatus,
                    previous_deadline: previousDeadline,
                    makeup_started_at: now.toISOString(),
                    recovery_until: recoveryUntil,
                    duration_minutes: durationMinutes,
                    deleted_answer_count: deletedAnswerCount || 0,
                    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
                },
            });
            if (logError) throw new BadRequestException('Jejak audit ujian susulan gagal disimpan.');

            return {
                attemptId,
                previousStatus,
                recoveryUntil,
                durationMinutes,
                deletedAnswerCount: deletedAnswerCount || 0,
            };
        });
    }

    private async databaseNow(db: DbSession): Promise<Date> {
        const rows = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = rows?.[0]?.now ? new Date(rows[0].now) : null;
        if (!now || !Number.isFinite(now.getTime())) {
            throw new BadRequestException('Waktu server belum dapat diperiksa.');
        }
        return now;
    }

    /**
     * Hentikan paksa pengerjaan seorang siswa.
     *
     * Ada DUA pemanggil yang sah: siswa yang menghentikan dirinya sendiri setelah
     * melewati batas pelanggaran, dan Proktor/Admin yang menghentikan siswa.
     * Keduanya diizinkan; siswa menghentikan pengerjaan ORANG LAIN tidak.
     */
    async forceTerminate(user: AuthUser, attemptId: string, reason: string, respectSubmitIntent = false): Promise<boolean> {
        const { data: target } = await this.db
            .from('cbt_exam_attempts')
            .select('user_id, organization_id')
            .eq('id', attemptId)
            .maybeSingle();

        if (!target) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const row = target as { user_id: string; organization_id: string | null };

        if (row.user_id !== user.id) {
            await this.authz.assertProktor(user, row.organization_id);
        }

        const now = await this.databaseNow(this.db);
        const closed = await this.db.transaction(async db => {
            await db.raw(
                'SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE',
                attemptId,
            );
            if (respectSubmitIntent) {
                const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                    .select('metadata').eq('id', attemptId).maybeSingle();
                if (readError) throw new BadRequestException('Status pengumpulan belum dapat diperiksa.');
                if (hasCommittedSubmitIntent(current?.metadata, await this.databaseNow(db))) return null;
            }
            const { data: updated, error } = await db
                .from('cbt_exam_attempts')
                .update({ status: 'auto_submitted', total_score: null, finished_at: now.toISOString() })
                .eq('id', attemptId)
                .eq('status', 'in_progress')
                .select('id')
                .maybeSingle();
            if (error) throw new BadRequestException('Status pengerjaan gagal disimpan.');
            if (!updated) return null;

            const { error: logError } = await db.from('cbt_attempt_security_logs').insert({
                attempt_id: attemptId,
                event_type: 'FORCE_TERMINATED',
                metadata: { reason, terminated_at: now.toISOString(), actor_user_id: user.id },
            });
            if (logError) throw new BadRequestException('Jejak terminasi gagal disimpan.');
            return updated;
        });
        if (!closed) return false;

        // Jawaban yang sudah tersimpan tetap dinilai. Tanpa ini attempt yang
        // dihentikan tidak pernah punya skor: total_score kosong dan seluruh
        // is_correct tetap null, karena jalur submit normal tidak pernah dilalui.
        try {
            const graded = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
            if (graded) {
                await this.grading.applyRelativeQuizScoringIfQuiz(graded.examId);
            }
        } catch (error) {
            // Kegagalan penilaian tidak boleh membatalkan terminasi — attempt
            // sudah ditutup di atas, dan itu bagian yang penting.
            this.logger.error(
                `Gagal menilai attempt ${attemptId} saat terminasi: ${(error as Error).message}`,
            );
        }

        // TIDAK ada global signout di sini.
        //
        // Versi lama memanggil `admin.signOut(userId, 'global')`. Parameter
        // pertamanya adalah JWT yang sedang login, BUKAN user id — jadi panggilan
        // itu selalu ditolak dan hasilnya tidak pernah diperiksa: sebuah no-op.
        // Kalau "diperbaiki" dengan JWT sungguhan, scope 'global' justru mencabut
        // SEMUA sesi siswa di semua aplikasi dan perangkat — jauh melebihi yang
        // dibutuhkan untuk menghentikan satu pengerjaan.
        //
        // Penguncian yang sebenarnya ada di tingkat attempt: statusnya sudah
        // auto_submitted, sehingga ujian tidak bisa dilanjutkan.
        return true;
    }
}
