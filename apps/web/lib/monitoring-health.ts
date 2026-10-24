import type { DeviceInfo, ExamAttemptRecord } from './api/proctor';

/** "Chrome 120 · Android · 10.0.0.5" — ringkasan perangkat untuk pengawas. */
export function deviceLabel(info?: Partial<DeviceInfo> | null, withIp = true): string {
    const parts = [info?.browser, info?.os, withIp ? info?.ip_address : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Perangkat tidak dikenali';
}

export const monitoringEventLabels: Record<string, string> = {
    SCREEN_SHARE_STOPPED: 'Berbagi layar dihentikan',
    ATTEMPT_STARTED: 'Mulai ujian', SUBMITTED: 'Dikumpulkan siswa', AUTO_SUBMITTED: 'Ditutup otomatis',
    RESET_BY_PROCTOR: 'Pemulihan dibuka', MAKEUP_EXAM_STARTED: 'Ujian susulan dibuka',
    FORCE_TERMINATED: 'Dihentikan pengawas', SYNC_HEALTH_CHANGED: 'Laporan penyimpanan berubah',
    CONNECTION_INTERRUPTION_REPORTED: 'Perangkat melaporkan gangguan koneksi',
    CONNECTION_GAP_DETECTED: 'Perangkat kembali terhubung setelah jeda',
    CONNECTION_LOST_AT_CLOSE: 'Waktu habis saat perangkat tanpa kontak',
    LATE_SECURITY_EVIDENCE: 'Catatan pengawasan susulan dari masa offline (tidak dihitung)',
    LOCAL_ANSWERS_NOT_COUNTED: 'Jawaban di perangkat tidak ikut dinilai',
    CLIENT_CONTEXT_CHANGED: 'Jaringan/browser peserta berganti di tengah sesi',
    SCREEN_SHARE_UNCONFIRMED: 'Berbagi layar tidak terkonfirmasi browser',
    screen_share_lost: 'Berbagi layar terputus lebih dari 30 detik (pelanggaran)',
    tab_switch: 'Berpindah tab', window_blur: 'Jendela kehilangan fokus', tab_close: 'Halaman dibuka kembali',
    focus_interruption: 'Gangguan fokus perangkat (tidak menambah pelanggaran)',
};
export const storageLabels: Record<string, string> = {
    healthy: 'Tersedia', fallback: 'Penyimpanan cadangan', unavailable: 'Gagal', unknown: 'Belum dilaporkan',
};
export function gradingLabel(attempt: ExamAttemptRecord) {
    if (!['submitted', 'auto_submitted'].includes(attempt.status)) return 'Belum dikumpulkan';
    const autoSubmitted = attempt.status === 'auto_submitted';
    const closed = attempt.metadata?.closed_by_staff ? 'Diselesaikan staf' : 'Ditutup otomatis';
    if (attempt.total_score == null) return autoSubmitted ? `${closed} · menunggu penilaian` : 'Menunggu penilaian';
    if (attempt.needs_manual_grading) {
        return autoSubmitted ? `${closed} · perlu penilaian manual` : 'Menunggu penilaian manual';
    }
    return autoSubmitted ? `${closed} · sudah dinilai` : 'Selesai dinilai';
}
export function monitoringAttention(attempt: ExamAttemptRecord, elapsedSeconds = 0) {
    const reasons = [...(attempt.attention_reasons || [])];
    if (attempt.status === 'in_progress' && elapsedSeconds > 45) reasons.push('Data monitoring belum diperbarui');
    return [...new Set(reasons)];
}
export function formatStudentName(name?: string | null, fallback = 'Tanpa nama'): string {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return fallback;
    if (trimmed.includes('@')) return trimmed;
    return trimmed
        .toLowerCase()
        .replace(/(^|[\s.-])(\p{L})/gu, (_, sep: string, char: string) => `${sep}${char.toUpperCase()}`);
}

export function getScoreColorClass(score?: number | string | null): string {
    if (score == null || score === '') return 'text-slate-400';
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) return 'text-slate-400';
    if (numeric <= 50) return 'text-red-600';
    if (numeric < 75) return 'text-orange-500';
    if (numeric <= 90) return 'text-emerald-600';
    return 'text-blue-600';
}

