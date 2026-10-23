export const MONITORING_EVENTS = ['SCREEN_SHARE_STOPPED', 'SYNC_HEALTH_CHANGED', 'CONNECTION_GAP_DETECTED', 'CONNECTION_INTERRUPTION_REPORTED',
    // Bukti audit dari pengamatan server, bukan pelanggaran: jaringan seluler
    // wajar berganti IP, jadi keduanya tidak boleh ikut menghentikan siswa.
    'CLIENT_CONTEXT_CHANGED', 'SCREEN_SHARE_UNCONFIRMED',
    // Jejak masa offline. Bukan pelanggaran baru (tidak menambah penghitung),
    // tetapi wajib terlihat oleh pengawas sebelum memutuskan pemulihan.
    'CONNECTION_LOST_AT_CLOSE', 'LATE_SECURITY_EVIDENCE', 'LOCAL_ANSWERS_NOT_COUNTED'];

/** Sama dengan ambang "offline" pada monitoring (attempt-health). */
export const CONNECTION_LOST_THRESHOLD_MS = 45_000;

/**
 * Bukti bahwa perangkat sudah tidak menghubungi server sebelum batas waktu.
 *
 * Tanpa catatan ini, siswa yang mematikan jaringan sampai waktu habis terlihat
 * sama dengan siswa yang tertib: pelanggaran selama offline tidak pernah sampai
 * ke server, dan penutupan otomatis tidak meninggalkan jejak apa pun.
 */
export function connectionLostAtClose(lastSeenAt: string | null | undefined, deadlineMs: number, closedAt: Date) {
    const seen = Date.parse(lastSeenAt || '');
    if (!Number.isFinite(seen) || !Number.isFinite(deadlineMs)) return null;
    const gap = Math.min(deadlineMs, closedAt.getTime()) - seen;
    if (gap <= CONNECTION_LOST_THRESHOLD_MS) return null;
    return { last_seen_at: new Date(seen).toISOString(), deadline_at: new Date(deadlineMs).toISOString(),
        closed_at: closedAt.toISOString(), gap_seconds: Math.round(gap / 1000) };
}

/**
 * Bandingkan identitas klien yang diamati server antar-heartbeat.
 *
 * `deviceId` disimpan browser dan dapat disalin ke perangkat lain; IP dan
 * browser/OS yang berganti di tengah satu pengerjaan adalah jejak yang tidak
 * dapat dipalsukan dengan cara yang sama, sehingga dicatat untuk pengawas.
 */
export function clientContextChange(
    previous: { browser?: string | null; os?: string | null; ip_address?: string | null } | null | undefined,
    current: { browser: string | null; os: string | null; ip_address: string | null },
): { fields: string[]; previous: Record<string, string | null>; current: Record<string, string | null> } | null {
    if (!previous || typeof previous !== 'object') return null;
    const fields = (['browser', 'os', 'ip_address'] as const).filter(field =>
        (previous[field] ?? null) !== null && current[field] !== null && previous[field] !== current[field]);
    if (!fields.length) return null;
    return {
        fields,
        previous: { browser: previous.browser ?? null, os: previous.os ?? null, ip_address: previous.ip_address ?? null },
        current: { browser: current.browser, os: current.os, ip_address: current.ip_address },
    };
}

export interface ClientSyncHealth {
    interruption?: { at: string; remainingSeconds: number; reason: 'browser_offline' | 'server_unreachable' };
    localAnswerCount: number;
    pendingAnswerCount: number;
    storageState: 'healthy' | 'fallback' | 'unavailable' | 'unknown';
}

export function validateSyncHealth(value?: ClientSyncHealth): ClientSyncHealth | undefined {
    if (value === undefined) return undefined;
    if (!value || !Number.isInteger(value.localAnswerCount) || value.localAnswerCount < 0 || value.localAnswerCount > 10000 ||
        !Number.isInteger(value.pendingAnswerCount) || value.pendingAnswerCount < 0 || value.pendingAnswerCount > 10000 ||
        !['healthy', 'fallback', 'unavailable', 'unknown'].includes(value.storageState)) {
        throw new Error('Laporan penyimpanan tidak valid.');
    }
    const interruption = value.interruption;
    if (interruption && (typeof interruption.at !== 'string' || interruption.at.length > 40 || !Number.isFinite(Date.parse(interruption.at)) ||
        !Number.isInteger(interruption.remainingSeconds) || interruption.remainingSeconds < 0 || interruption.remainingSeconds > 604800 ||
        !['browser_offline', 'server_unreachable'].includes(interruption.reason))) throw new Error('Laporan koneksi tidak valid.');
    return { ...(interruption ? { interruption: { at: interruption.at, remainingSeconds: interruption.remainingSeconds, reason: interruption.reason } } : {}), localAnswerCount: value.localAnswerCount, pendingAnswerCount: value.pendingAnswerCount, storageState: value.storageState };
}
