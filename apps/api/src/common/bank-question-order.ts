/**
 * Urutan soal di layar penyusunan: `metadata.order_index` bila ada, lalu
 * `created_at`, lalu `id`.
 *
 * Pemutus terakhir berdasarkan id itu bukan hiasan: soal hasil impor massal
 * berbagi `created_at` yang sama persis, dan tanpa pemutus yang pasti, menyimpan
 * satu soal bisa mengacak nomor soal lainnya.
 */
export function compareQuestions(a: any, b: any): number {
    const orderA = a.metadata?.order_index;
    const orderB = b.metadata?.order_index;

    if (orderA !== undefined && orderB !== undefined) {
        if (orderA !== orderB) return orderA - orderB;
    } else if (orderA !== undefined) {
        return -1;
    } else if (orderB !== undefined) {
        return 1;
    }

    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;

    return String(a.id).localeCompare(String(b.id));
}
