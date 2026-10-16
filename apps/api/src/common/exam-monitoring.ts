export const MONITORING_EVENTS = ['SCREEN_SHARE_STOPPED', 'SYNC_HEALTH_CHANGED', 'CONNECTION_GAP_DETECTED', 'CONNECTION_INTERRUPTION_REPORTED'];

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
