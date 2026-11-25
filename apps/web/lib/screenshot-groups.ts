/** Semua screenshot satu peserta (satu attempt), terbaru lebih dulu. */
export interface StudentScreenshots<T extends { attempt_id: string; created_at: string }> {
    attemptId: string;
    rows: T[];
}

/**
 * Kelompokkan screenshot per peserta untuk tab Screenshot monitoring. Urutan
 * kelompok mengikuti gambar terbaru masing-masing peserta; di dalam kelompok,
 * terbaru lebih dulu (gambar pertama menjadi sampul kartu peserta).
 */
export function groupScreenshotsByStudent<T extends { attempt_id: string; created_at: string }>(rows: T[]): StudentScreenshots<T>[] {
    const groups = new Map<string, T[]>();
    for (const row of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
        const list = groups.get(row.attempt_id);
        if (list) list.push(row); else groups.set(row.attempt_id, [row]);
    }
    return [...groups].map(([attemptId, list]) => ({ attemptId, rows: list }));
}
