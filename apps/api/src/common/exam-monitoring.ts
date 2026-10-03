export const MONITORING_EVENTS = ['SYNC_HEALTH_CHANGED', 'CONNECTION_GAP_DETECTED'];

export interface ClientSyncHealth {
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
    return { localAnswerCount: value.localAnswerCount, pendingAnswerCount: value.pendingAnswerCount, storageState: value.storageState };
}
