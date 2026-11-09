/**
 * Ganti gambar `data:image/...;base64,...` di dalam muatan impor soal dengan URL
 * berkas yang sudah diunggah ke penyimpanan.
 *
 * Parser Word (mammoth) menanam setiap gambar dokumen sebagai base64 di HTML
 * soal. Dokumen bergambar dengan mudah melewati 10 MB, padahal Next.js memotong
 * body permintaan yang melewati middleware pada 10 MB (proxyClientMaxBodySize)
 * — yang tiba di route impor hanya potongan JSON, sehingga impor gagal dengan
 * "Muatan permintaan bukan JSON yang sah". Base64 yang tersimpan juga membuat
 * setiap pemuatan soal ujian jauh lebih berat. Karena itu gambar diunggah satu
 * per satu lebih dulu, sama seperti gambar yang disisipkan lewat editor soal.
 *
 * Modul ini sengaja murni (pengunggah disuntikkan) supaya dapat diuji di Node.
 */

export type InlineImageUploader = (file: File) => Promise<string>;

export interface InlineImageProgress {
    done: number;
    total: number;
}

export interface ReplaceInlineImagesOptions {
    upload: InlineImageUploader;
    onProgress?: (progress: InlineImageProgress) => void;
    /** Unggahan paralel; endpoint penyimpanan dibatasi 60 unggahan/menit per akun. */
    concurrency?: number;
    /** Jeda sebelum mencoba ulang unggahan yang gagal (mis. kena batas laju). */
    retryDelaysMs?: number[];
    /** Untuk tes: pengganti setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}

const DATA_IMAGE = /data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})/gi;

/** Jenis yang diterima penyimpanan dan dapat ditampilkan browser. */
const EXTENSION_BY_SUBTYPE: Record<string, string> = {
    png: 'png',
    jpeg: 'jpg',
    jpg: 'jpg',
    pjpeg: 'jpg',
    gif: 'gif',
    webp: 'webp',
    bmp: 'bmp',
    'svg+xml': 'svg',
};

const MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};

/**
 * Hasil unggahan diingat selama halaman terbuka. Mencoba ulang impor yang sama
 * memakai URL yang sama, jadi isi permintaannya identik dan perlindungan impor
 * ganda di server (clientRequestId + hash muatan) tetap berlaku.
 */
const uploadedByDigest = new Map<string, Promise<string>>();

/** Untuk tes. */
export function clearInlineImageCache(): void {
    uploadedByDigest.clear();
}

/** Semua data URL gambar unik di dalam nilai apa pun (string, array, objek). */
export function collectInlineImages(value: unknown): string[] {
    const found = new Set<string>();
    walkStrings(value, text => {
        for (const match of text.matchAll(DATA_IMAGE)) found.add(match[0]);
    });
    return [...found];
}

export function inlineImageBytes(value: unknown): number {
    return collectInlineImages(value).reduce((total, dataUrl) => total + dataUrl.length, 0);
}

export async function replaceInlineImages<T>(value: T, options: ReplaceInlineImagesOptions): Promise<T> {
    const images = collectInlineImages(value);
    if (images.length === 0) return value;

    const unsupported = new Map<string, number>();
    for (const dataUrl of images) {
        const subtype = subtypeOf(dataUrl);
        if (!EXTENSION_BY_SUBTYPE[subtype]) unsupported.set(subtype, (unsupported.get(subtype) || 0) + 1);
    }
    if (unsupported.size) {
        const count = [...unsupported.values()].reduce((sum, n) => sum + n, 0);
        const kinds = [...unsupported.keys()].map(describeSubtype).join(', ');
        throw new Error(
            `${count} gambar di dokumen berformat ${kinds} yang tidak dapat ditampilkan browser. ` +
            'Di Word, ganti gambar tersebut dengan versi PNG/JPG (klik kanan gambar → Simpan sebagai Gambar, ' +
            'lalu sisipkan ulang), kemudian import lagi.',
        );
    }

    const {
        upload,
        onProgress,
        concurrency = 3,
        retryDelaysMs = [3_000, 10_000, 30_000],
        sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    } = options;

    const urls = new Map<string, string>();
    let done = 0;
    onProgress?.({ done, total: images.length });

    const uploadOne = async (dataUrl: string) => {
        const file = await dataUrlToFile(dataUrl);
        const digest = file.name.split('.')[0];
        let pending = uploadedByDigest.get(digest);
        if (!pending) {
            pending = uploadWithRetry(file, upload, retryDelaysMs, sleep);
            uploadedByDigest.set(digest, pending);
            // Kegagalan tidak diingat: percobaan berikutnya harus mengunggah lagi.
            pending.catch(() => uploadedByDigest.delete(digest));
        }
        urls.set(dataUrl, await pending);
        done += 1;
        onProgress?.({ done, total: images.length });
    };

    const queue = [...images];
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) await uploadOne(next);
    });
    await Promise.all(workers);

    return mapStrings(value, text => text.replace(DATA_IMAGE, match => urls.get(match) ?? match)) as T;
}

async function uploadWithRetry(file: File, upload: InlineImageUploader, delays: number[],
    sleep: (ms: number) => Promise<void>): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (attempt > 0) await sleep(delays[attempt - 1]);
        try {
            const url = await upload(file);
            if (typeof url === 'string' && url) return url;
            lastError = new Error('Alamat gambar hasil unggahan kosong.');
        } catch (error) {
            lastError = error;
        }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError || 'tidak diketahui');
    throw new Error(`Gagal mengunggah gambar soal: ${reason}`);
}

function subtypeOf(dataUrl: string): string {
    return dataUrl.slice('data:image/'.length, dataUrl.indexOf(';')).toLowerCase();
}

function describeSubtype(subtype: string): string {
    if (subtype === 'x-emf' || subtype === 'emf') return 'EMF';
    if (subtype === 'x-wmf' || subtype === 'wmf') return 'WMF';
    if (subtype === 'tiff' || subtype === 'tif') return 'TIFF';
    return subtype.toUpperCase();
}

async function dataUrlToFile(dataUrl: string): Promise<File> {
    const extension = EXTENSION_BY_SUBTYPE[subtypeOf(dataUrl)];
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const digest = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    return new File([bytes], `${digest}.${extension}`, { type: MIME_BY_EXTENSION[extension] });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function walkStrings(value: unknown, visit: (text: string) => void): void {
    if (typeof value === 'string') { if (value.includes('data:image/')) visit(value); return; }
    if (Array.isArray(value)) { for (const item of value) walkStrings(item, visit); return; }
    if (isPlainObject(value)) for (const item of Object.values(value)) walkStrings(item, visit);
}

function mapStrings(value: unknown, transform: (text: string) => string): unknown {
    if (typeof value === 'string') return value.includes('data:image/') ? transform(value) : value;
    if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, transform);
        return out;
    }
    return value;
}
