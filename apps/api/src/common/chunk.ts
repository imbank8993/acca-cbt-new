/**
 * Pecah array menjadi potongan berukuran tetap.
 *
 * Dipakai saat menyusun klausa `IN (...)` untuk ribuan id. Daftar yang terlalu
 * panjang membuat pernyataan SQL membengkak dan perencana query melambat.
 */
export function chunk<T>(items: T[], size: number): T[][] {
    if (size <= 0) throw new Error('Ukuran potongan harus lebih dari nol.');
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
}
