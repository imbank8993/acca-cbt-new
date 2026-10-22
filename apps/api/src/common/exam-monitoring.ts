export const MONITORING_EVENTS = ['SCREEN_SHARE_STOPPED', 'SYNC_HEALTH_CHANGED', 'CONNECTION_GAP_DETECTED', 'CONNECTION_INTERRUPTION_REPORTED',
    // Bukti audit dari pengamatan server, bukan pelanggaran: jaringan seluler
    // wajar berganti IP, jadi keduanya tidak boleh ikut menghentikan siswa.
    'CLIENT_CONTEXT_CHANGED', 'SCREEN_SHARE_UNCONFIRMED'];

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
