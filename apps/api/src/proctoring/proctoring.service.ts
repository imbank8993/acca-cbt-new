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
import { DbService } from '../prisma/prisma-db-adapter';

/**
 * Event yang TIDAK dihitung sebagai peringatan.
 *
 * `tab_close` sengaja dikecualikan: ia dicatat diam-diam saat halaman ujian
 * dibuka kembali (tab sempat tertutup, browser crash, jaringan putus) TANPA
 * modal peringatan ke siswa. Bila ikut dihitung, siswa yang browsernya sempat
 * tertutup dua kali sudah membawa dua "pelanggaran" tak terlihat — satu
 * pelanggaran nyata langsung memicu terminasi. Event-nya tetap ditulis ke log
 * sehingga proktor tetap melihat kolomnya di monitoring.
 */
const NON_WARNING_EVENTS = [
    'RESET_BY_PROCTOR',
    'FORCE_TERMINATED',
    'DEVICE_SWITCH_BLOCKED',
    'LATE_ANSWER_SYNC',
    'tab_close',
];

/** Klien mengirim 'tab_switch' dan 'window_blur'; 'blur' adalah nilai warisan. */
const TAB_SWITCH_EVENTS = ['tab_switch', 'window_blur', 'blur'];
export const STUDENT_SECURITY_EVENTS = [
    ...TAB_SWITCH_EVENTS, 'exit_fullscreen', 'restricted_shortcut',
    'copy_paste_attempt', 'right_click_attempt', 'tab_close',
];

/** Status attempt yang boleh di-reset proktor. */
const RESETTABLE_STATUSES = ['auto_submitted', 'submitted'];

/** Tenggat tambahan saat attempt yang deadline-nya sudah lewat di-reset. */
const RESET_GRACE_MS = 15 * 60 * 1000;

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
    ) {
        if (!STUDENT_SECURITY_EVENTS.includes(eventType)) {
            throw new BadRequestException('Jenis event siswa tidak diizinkan.');
        }
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('user_id, status')
            .eq('id', attemptId)
            .maybeSingle();

        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const row = attempt as { user_id: string; status: string };

        if (row.user_id !== user.id) {
            throw new ForbiddenException('Tidak diizinkan.');
        }
        if (row.status !== 'in_progress') {
            throw new BadRequestException('Ujian tidak sedang berlangsung.');
        }

        await this.db
            .from('cbt_attempt_security_logs')
            .insert({ attempt_id: attemptId, event_type: eventType,
                metadata: { ...metadata, actor_id: user.id, source: 'student' } });

        // Penghitung diturunkan dengan MENGHITUNG baris log, bukan dengan
        // baca-ubah-tulis. Increment kehilangan kenaikan yang bersamaan ketika
        // beberapa event terpicu berdekatan.
        const { data: lastReset } = await this.db
            .from('cbt_attempt_security_logs')
            .select('created_at')
            .eq('attempt_id', attemptId)
            .eq('event_type', 'RESET_BY_PROCTOR')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const since = (lastReset as { created_at?: string } | null)?.created_at;

        let warningQuery = this.db
            .from('cbt_attempt_security_logs')
            .select('*', { count: 'exact', head: true })
            .eq('attempt_id', attemptId)
            .not('event_type', 'in', NON_WARNING_EVENTS);
        if (since) warningQuery = warningQuery.gt('created_at', since);
        const { count: warningCount } = await warningQuery;

        const updates: Record<string, unknown> = { warning_count: warningCount || 0 };

        if (TAB_SWITCH_EVENTS.includes(eventType)) {
            let tabQuery = this.db
                .from('cbt_attempt_security_logs')
                .select('*', { count: 'exact', head: true })
                .eq('attempt_id', attemptId)
                .in('event_type', TAB_SWITCH_EVENTS);
            if (since) tabQuery = tabQuery.gt('created_at', since);
            const { count: tabCount } = await tabQuery;
            updates.tab_switch_count = tabCount || 0;
        }

        await this.db.from('cbt_exam_attempts').update(updates).eq('id', attemptId);

        return { warningCount: (updates.warning_count as number) || 0 };
    }

    /**
     * Kembalikan attempt yang sudah tertutup ke `in_progress` dengan jawaban utuh.
     *
     * Berlaku untuk attempt yang DITUTUP SISTEM maupun yang SUDAH DISUBMIT siswa
     * (salah pencet "Selesai", atau guru meminta perbaikan). Attempt yang masih
     * berjalan tidak perlu — dan tidak boleh — di-reset.
     */
    async resetAttempt(user: AuthUser, attemptId: string) {
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('id, user_id, exam_id, status, personal_end_time')
            .eq('id', attemptId)
            .maybeSingle();

        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const row = attempt as {
            exam_id: string;
            status: string;
            personal_end_time: string | null;
        };

        // Proktor/Admin bebas; Guru hanya ujian non-PAS/PAT buatannya sendiri.
        // Tanpa ini siswa bisa membatalkan terminasi attempt-nya sendiri.
        await this.authz.assertExamStaff(user, row.exam_id);

        if (!RESETTABLE_STATUSES.includes(row.status)) {
            throw new BadRequestException(
                'Hanya ujian yang sudah selesai (submit / ditutup sistem) yang bisa di-reset.',
            );
        }

        const updates: Record<string, unknown> = {
            status: 'in_progress',
            finished_at: null,
            warning_count: 0,
            tab_switch_count: 0,
            // Kunci perangkat dilepas supaya siswa bisa melanjutkan di perangkat
            // yang kini ia pegang — justru itu inti dari reset oleh proktor.
            device_fingerprint: null,
        };

        // Deadline personal yang sudah lewat membuat resume langsung ditutup
        // otomatis lagi, sehingga reset jadi sia-sia. Jendela ujian tetap
        // berlaku sebagai pagar terluar saat resume.
        const expired =
            !row.personal_end_time || new Date(row.personal_end_time).getTime() <= Date.now();
        if (expired) {
            updates.personal_end_time = new Date(Date.now() + RESET_GRACE_MS).toISOString();
        }

        await this.db.from('cbt_exam_attempts').update(updates).eq('id', attemptId);

        await this.db.from('cbt_attempt_security_logs').insert({
            attempt_id: attemptId,
            event_type: 'RESET_BY_PROCTOR',
            metadata: {
                resetAt: new Date().toISOString(),
                previous_status: row.status,
                extended_deadline: updates.personal_end_time ?? null,
            },
        });
    }

    /**
     * Hentikan paksa pengerjaan seorang siswa.
     *
     * Ada DUA pemanggil yang sah: siswa yang menghentikan dirinya sendiri setelah
     * melewati batas pelanggaran, dan Proktor/Admin yang menghentikan siswa.
     * Keduanya diizinkan; siswa menghentikan pengerjaan ORANG LAIN tidak.
     */
    async forceTerminate(user: AuthUser, attemptId: string, reason: string) {
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

        const { data: closed, error } = await this.db
            .from('cbt_exam_attempts')
            .update({ status: 'auto_submitted', finished_at: new Date().toISOString() })
            .eq('id', attemptId).eq('status', 'in_progress').select('id').maybeSingle();
        if (error) throw new BadRequestException('Status pengerjaan gagal disimpan.');
        if (!closed) return;

        // Jawaban yang sudah tersimpan tetap dinilai. Tanpa ini attempt yang
        // dihentikan tidak pernah punya skor: total_score kosong dan seluruh
        // is_correct tetap null, karena jalur submit normal tidak pernah dilalui.
        try {
            const graded = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
            if (graded) {
                await this.db
                    .from('cbt_exam_attempts')
                    .update({
                        total_score: graded.finalScore100,
                        needs_manual_grading: graded.hasEssay,
                    })
                    .eq('id', attemptId);
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

        await this.db.from('cbt_attempt_security_logs').insert({
            attempt_id: attemptId,
            event_type: 'FORCE_TERMINATED',
            metadata: { reason },
        });
    }
}
