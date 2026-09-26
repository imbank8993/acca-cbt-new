const BASE_RETRY_MS = 10_000;
const MAX_RETRY_MS = 30_000;

/**
 * Backoff auto-submit tanpa batas jumlah percobaan.
 *
 * Nilainya dibatasi 30 detik agar ujian tetap pulih ketika backend kembali,
 * tetapi tidak menembaki server terus-menerus selama gangguan panjang.
 */
export function examAutoRetryDelay(failureCount: number): number {
    const safeCount = Math.max(0, Math.floor(failureCount));
    return Math.min(BASE_RETRY_MS * (2 ** Math.min(safeCount, 2)), MAX_RETRY_MS);
}
