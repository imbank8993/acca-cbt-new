import { apiSend } from './client';

export interface UnusedImageItem {
    key: string;
    size: number;
    lastModified: string | null;
}

export interface UnusedImagesPreview {
    minAgeDays: number;
    scannedObjects: number;
    imageObjects: number;
    referencedCount: number;
    recentCount: number;
    scannedTables: number;
    unusedCount: number;
    unusedBytes: number;
    listingTruncated: boolean;
    truncated: boolean;
    items: UnusedImageItem[];
}

export interface UnusedImagesCleanupResult {
    requested: number;
    deleted: number;
    skipped: number;
    failed: number;
    failedKeys: { key: string; error: string }[];
    freedBytes: number;
}

/** Pemindaian membaca seluruh penyimpanan dan database, jadi batas tunggunya panjang. */
const CLEANUP_TIMEOUT_MS = 10 * 60_000;

export function previewUnusedImages(minAgeDays = 30) {
    return apiSend<UnusedImagesPreview>('/api/storage/cleanup/unused-images/preview', { minAgeDays }, 'POST',
        { timeoutMs: CLEANUP_TIMEOUT_MS });
}

export function deleteUnusedImages(keys: string[], minAgeDays = 30) {
    return apiSend<UnusedImagesCleanupResult>('/api/storage/cleanup/unused-images/delete', { keys, minAgeDays }, 'POST',
        { timeoutMs: CLEANUP_TIMEOUT_MS });
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toLocaleString('id-ID', { maximumFractionDigits: unit < 2 ? 0 : 1 })} ${units[unit]}`;
}
