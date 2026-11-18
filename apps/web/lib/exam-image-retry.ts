/**
 * Coba ulang gambar soal (/api/storage/file/...) yang gagal dimuat di halaman ujian.
 *
 * Browser tidak pernah mencoba ulang <img> yang gagal: saat server sedang berat
 * atau jaringan putus sesaat, gambar soal dan opsi tetap berupa ikon rusak
 * walaupun server sudah pulih, sampai siswa memuat ulang halaman. Di sini setiap
 * gambar berkas yang gagal dicoba ulang dengan jeda makin panjang plus acak
 * (agar ratusan siswa tidak serentak membebani server), dan semua gambar rusak
 * dicoba lagi begitu perangkat kembali online.
 */

const STORAGE_FILE = '/api/storage/file/';
/** Jeda percobaan ulang ke-1, ke-2, …; setelahnya jeda terakhir dipakai berulang. */
export const IMAGE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
/** Batas percobaan per gambar (~8 menit), supaya gambar yang memang hilang tidak dicoba selamanya. */
export const IMAGE_RETRY_MAX = 12;

export function imageRetryDelay(attempt: number, random: () => number = Math.random): number {
    const base = IMAGE_RETRY_DELAYS_MS[Math.min(attempt, IMAGE_RETRY_DELAYS_MS.length - 1)];
    return Math.round(base * (0.75 + random() * 0.5));
}

function isStorageImage(img: HTMLImageElement): boolean {
    const src = img.getAttribute('src') || '';
    return src.includes(STORAGE_FILE);
}

/** Pasang di dokumen halaman ujian; kembalikan fungsi pembersih. */
export function installExamImageRetry(doc: Document = document): () => void {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const retry = (img: HTMLImageElement) => {
        const attempt = Number(img.dataset.imageRetry || 0);
        if (attempt >= IMAGE_RETRY_MAX) return;
        img.dataset.imageRetry = String(attempt + 1);
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!img.isConnected || !isStorageImage(img)) return;
            // Menyetel ulang src yang sama memicu unduhan baru untuk gambar yang rusak.
            img.src = img.getAttribute('src') || img.src;
        }, imageRetryDelay(attempt));
        timers.add(timer);
    };

    // Event `error` <img> tidak bubbling; fase capture menangkap semua gambar,
    // termasuk yang dirender lewat HTML soal (dangerouslySetInnerHTML).
    const onError = (event: Event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !isStorageImage(img)) return;
        retry(img);
    };
    const onLoad = (event: Event) => {
        const img = event.target;
        if (img instanceof HTMLImageElement && img.dataset.imageRetry) delete img.dataset.imageRetry;
    };
    // Kembali online: coba lagi semua gambar yang masih rusak, dengan jatah baru.
    const onOnline = () => {
        for (const img of Array.from(doc.images)) {
            if (isStorageImage(img) && img.complete && img.naturalWidth === 0) {
                delete img.dataset.imageRetry;
                retry(img);
            }
        }
    };

    doc.addEventListener('error', onError, true);
    doc.addEventListener('load', onLoad, true);
    doc.defaultView?.addEventListener('online', onOnline);
    return () => {
        doc.removeEventListener('error', onError, true);
        doc.removeEventListener('load', onLoad, true);
        doc.defaultView?.removeEventListener('online', onOnline);
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
    };
}
