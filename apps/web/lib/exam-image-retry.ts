/**
 * Pemulihan gambar soal (/api/storage/file/...) yang gagal dimuat di halaman ujian.
 *
 * Browser tidak pernah mencoba ulang <img> yang gagal, dan tidak memberi tahu
 * MENGAPA gagal. Di sini setiap kegagalan diperiksa lewat satu permintaan
 * diagnostik (fetch biasa, tidak lewat cache service worker), lalu ditangani
 * sesuai penyebabnya:
 *
 *  - jaringan putus / server lambat (5xx, 408, 429, timeout) → coba ulang dengan
 *    jeda makin panjang + acak; saat kembali online semua dicoba lagi.
 *  - 401 sesi login tidak berlaku → minta halaman memperpanjang sesi; bila berhasil
 *    semua gambar dicoba lagi, bila tidak siswa diberi tahu untuk login ulang.
 *  - 200 padahal <img> gagal (cache/service worker bermasalah) → gambar dipasang
 *    dari hasil unduhan diagnostik itu sendiri.
 *  - 403 tidak diizinkan / 404 berkas hilang → tidak dicoba terus-menerus; gambar
 *    diganti pesan yang jelas agar siswa memberi tahu pengawas.
 */

const STORAGE_FILE = '/api/storage/file/';
/** Jeda percobaan ulang ke-1, ke-2, …; setelahnya jeda terakhir dipakai berulang. */
export const IMAGE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
/** Batas percobaan per gambar untuk gangguan sementara (~8 menit). */
export const IMAGE_RETRY_MAX = 12;
/** 403 bisa sementara (mis. ujian belum dimulai); dicoba lagi pelan beberapa kali. */
const FORBIDDEN_RETRY_MAX = 3;
const FORBIDDEN_RETRY_MS = 60_000;

export type ImageFailure = 'transient' | 'auth' | 'forbidden' | 'missing' | 'ok';

export const IMAGE_FAILURE_TEXT: Record<'forbidden' | 'missing' | 'auth', string> = {
    auth: 'Gambar belum dapat dimuat karena sesi login berakhir.',
    forbidden: 'Gambar tidak dapat dibuka untuk sesi ini. Beri tahu pengawas.',
    missing: 'Gambar soal tidak ditemukan. Beri tahu pengawas.',
};

export function imageRetryDelay(attempt: number, random: () => number = Math.random): number {
    const base = IMAGE_RETRY_DELAYS_MS[Math.min(attempt, IMAGE_RETRY_DELAYS_MS.length - 1)];
    return Math.round(base * (0.75 + random() * 0.5));
}

/** Golongkan hasil permintaan diagnostik. `null` = permintaan gagal di jaringan. */
export function classifyImageStatus(status: number | null): ImageFailure {
    if (status === null || status === 0) return 'transient';
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status === 404 || status === 410) return 'missing';
    return 'transient';
}

function isStorageImage(img: HTMLImageElement): boolean {
    return (img.getAttribute('src') || '').includes(STORAGE_FILE);
}

export interface ExamImageRetryController {
    /** Coba lagi semua gambar soal yang masih rusak (mis. setelah sesi diperpanjang). */
    retryAll: () => void;
    dispose: () => void;
}

export function installExamImageRetry(doc: Document = document, options: {
    /** Dipanggil (dibatasi sekali per 30 detik) saat gambar ditolak karena sesi. */
    onAuthFailure?: () => void;
    fetchImpl?: typeof fetch;
} = {}): ExamImageRetryController {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const probes = new Map<string, Promise<{ kind: ImageFailure; blob?: Blob }>>();
    /** Gambar yang dipasang dari unduhan diagnostik, dipakai ulang per alamat asli. */
    const blobByUrl = new Map<string, string>();
    const doFetch = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    let lastAuthNotice = 0;
    let disposed = false;

    const schedule = (img: HTMLImageElement, delay: number) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (disposed || !img.isConnected || !isStorageImage(img)) return;
            img.src = img.getAttribute('src') || img.src;
        }, delay);
        timers.add(timer);
    };

    const probe = (url: string) => {
        const pending = probes.get(url);
        if (pending) return pending;
        const run = (async () => {
            if (!doFetch) return { kind: 'transient' as const };
            try {
                const response = await doFetch(url, { credentials: 'same-origin', cache: 'no-store' });
                const kind = classifyImageStatus(response.status);
                if (kind === 'ok' && (response.headers.get('content-type') || '').startsWith('image/')) {
                    return { kind, blob: await response.blob() };
                }
                return { kind: kind === 'ok' ? 'transient' as const : kind };
            } catch {
                return { kind: 'transient' as const };
            }
        })().finally(() => probes.delete(url));
        probes.set(url, run);
        return run;
    };

    const markUnavailable = (img: HTMLImageElement, kind: 'forbidden' | 'missing' | 'auth') => {
        img.dataset.imageState = kind;
        img.alt = IMAGE_FAILURE_TEXT[kind];
        img.title = IMAGE_FAILURE_TEXT[kind];
    };

    const handleFailure = async (img: HTMLImageElement) => {
        const url = img.getAttribute('src') || '';
        const known = blobByUrl.get(url);
        if (known) { img.dataset.imageSource = url; img.src = known; return; }
        const attempt = Number(img.dataset.imageRetry || 0);
        img.dataset.imageRetry = String(attempt + 1);
        // Offline: tidak perlu diagnosis; semua dicoba lagi saat event `online`.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const result = await probe(url);
        if (disposed || !img.isConnected || (img.getAttribute('src') || '') !== url) return;

        if (result.kind === 'ok' && result.blob) {
            // Server mengirim gambar dengan benar, tetapi <img> tetap gagal (cache atau
            // service worker bermasalah): pasang langsung dari unduhan diagnostik.
            const blobUrl = blobByUrl.get(url) || URL.createObjectURL(result.blob);
            blobByUrl.set(url, blobUrl);
            img.dataset.imageSource = url;
            img.src = blobUrl;
            return;
        }
        if (result.kind === 'auth') {
            markUnavailable(img, 'auth');
            if (Date.now() - lastAuthNotice > 30_000) {
                lastAuthNotice = Date.now();
                options.onAuthFailure?.();
            }
            if (attempt < IMAGE_RETRY_MAX) schedule(img, imageRetryDelay(attempt));
            return;
        }
        if (result.kind === 'forbidden') {
            markUnavailable(img, 'forbidden');
            const forbidden = Number(img.dataset.imageForbidden || 0);
            img.dataset.imageForbidden = String(forbidden + 1);
            if (forbidden < FORBIDDEN_RETRY_MAX) schedule(img, FORBIDDEN_RETRY_MS);
            return;
        }
        if (result.kind === 'missing') {
            markUnavailable(img, 'missing');
            return;
        }
        if (attempt < IMAGE_RETRY_MAX) schedule(img, imageRetryDelay(attempt));
    };

    // Event `error` <img> tidak bubbling; fase capture menangkap semua gambar,
    // termasuk yang dirender lewat HTML soal (dangerouslySetInnerHTML).
    const onError = (event: Event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !isStorageImage(img)) return;
        void handleFailure(img);
    };
    const onLoad = (event: Event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        delete img.dataset.imageRetry;
        delete img.dataset.imageForbidden;
        if (img.dataset.imageState) {
            delete img.dataset.imageState;
            img.removeAttribute('title');
        }
    };
    const retryAll = () => {
        for (const img of Array.from(doc.images)) {
            if (isStorageImage(img) && img.complete && img.naturalWidth === 0) {
                delete img.dataset.imageRetry;
                delete img.dataset.imageForbidden;
                schedule(img, imageRetryDelay(0));
            }
        }
    };

    doc.addEventListener('error', onError, true);
    doc.addEventListener('load', onLoad, true);
    doc.defaultView?.addEventListener('online', retryAll);
    return {
        retryAll,
        dispose: () => {
            disposed = true;
            doc.removeEventListener('error', onError, true);
            doc.removeEventListener('load', onLoad, true);
            doc.defaultView?.removeEventListener('online', retryAll);
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            for (const blobUrl of blobByUrl.values()) URL.revokeObjectURL(blobUrl);
            blobByUrl.clear();
        },
    };
}
