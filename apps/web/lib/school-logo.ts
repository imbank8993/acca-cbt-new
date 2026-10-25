import { resolveStorageUrl } from './safe-url';

/**
 * Logo sekolah untuk kop dokumen.
 *
 * Logo dibaca lewat endpoint same-origin lebih dulu (server mengambilkannya
 * dari bucket atau host luar), lalu dari URL aslinya sebagai cadangan. Hasilnya
 * selalu PNG data URL beserta ukurannya, sehingga:
 *  - jsPDF dapat menyematkan logo apa pun formatnya (PNG, JPEG, WebP, SVG);
 *  - logo digambar sesuai rasio aslinya, tidak gepeng;
 *  - jendela cetak tidak menunggu atau gagal memuat gambar dari host luar.
 */
export const SCHOOL_LOGO_ENDPOINT = '/api/storage/school-logo';

export interface KopLogo {
    dataUrl: string;
    width: number;
    height: number;
}

/** Sisi terpanjang hasil konversi: cukup tajam untuk logo ±25 mm pada cetak 300 dpi. */
const LOGO_RASTER_SIZE = 600;
const cache = new Map<string, Promise<KopLogo | null>>();

/** Ukuran logo di dalam kotak tanpa mengubah rasio. */
export function fitLogo(logo: Pick<KopLogo, 'width' | 'height'>, boxWidth: number, boxHeight: number) {
    if (!logo.width || !logo.height) return { width: boxWidth, height: boxHeight };
    const scale = Math.min(boxWidth / logo.width, boxHeight / logo.height);
    return { width: logo.width * scale, height: logo.height * scale };
}

async function rasterize(blob: Blob): Promise<KopLogo | null> {
    if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.decoding = 'async';
        image.src = objectUrl;
        await image.decode();
        // SVG tanpa ukuran intrinsik dilaporkan 0×0; perlakukan sebagai persegi.
        const naturalWidth = image.naturalWidth || LOGO_RASTER_SIZE;
        const naturalHeight = image.naturalHeight || LOGO_RASTER_SIZE;
        const scale = LOGO_RASTER_SIZE / Math.max(naturalWidth, naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function fetchLogo(source: string): Promise<KopLogo | null> {
    if (!source) return null;
    try {
        const response = await fetch(source, { credentials: 'same-origin' });
        if (!response.ok) return null;
        return await rasterize(await response.blob());
    } catch {
        return null;
    }
}

/**
 * Muat logo kop dari `profil_sekolah.logo_url`. Mengembalikan `null` bila
 * sekolah belum mengatur logo atau logo tidak dapat dibaca; kop tetap dicetak
 * tanpa logo pada kasus itu.
 */
export function loadKopLogo(logoUrl: string | null | undefined): Promise<KopLogo | null> {
    const url = (logoUrl || '').trim();
    if (!url || typeof window === 'undefined') return Promise.resolve(null);
    let pending = cache.get(url);
    if (!pending) {
        pending = url.startsWith('data:image/')
            ? fetchLogo(url)
            : fetchLogo(SCHOOL_LOGO_ENDPOINT).then(logo => logo || fetchLogo(resolveStorageUrl(url)));
        cache.set(url, pending);
        // Kegagalan tidak di-cache agar percobaan berikutnya (mis. setelah koneksi pulih) mencoba lagi.
        void pending.then(logo => { if (!logo) cache.delete(url); });
    }
    return pending;
}
