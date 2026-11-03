/**
 * Cover bank soal: batas ukuran berkas asli dan kompresi ke WebP sebelum diunggah.
 *
 * Cover hanya tampil kecil (≈48–96 px), jadi gambar diperkecil ke sisi terpanjang
 * 512 px (tetap tajam di layar retina) lalu disimpan sebagai WebP. Hasilnya umumnya
 * puluhan KB, bukan beberapa MB seperti JPEG resolusi penuh hasil crop.
 */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_ACCEPT = 'image/jpeg,image/png,image/webp';
const COVER_TYPES = COVER_ACCEPT.split(',');
const COVER_MAX_SIDE = 512;
const COVER_QUALITY = 0.82;

/** Pesan galat bila berkas tidak layak dijadikan cover; null bila layak. */
export function validateCoverFile(file: File): string | null {
    if (!COVER_TYPES.includes(file.type)) return 'Cover harus berupa gambar JPG, PNG, atau WebP.';
    if (file.size > COVER_MAX_BYTES) return `Ukuran cover maksimal 5 MB (berkas ini ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    if (file.size === 0) return 'Berkas cover kosong.';
    return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Perkecil gambar (data URL hasil crop atau Blob) dan ubah ke WebP.
 * Peramban yang belum bisa membuat WebP mendapat JPEG terkompresi sebagai cadangan.
 */
export async function compressCoverImage(source: string | Blob): Promise<File> {
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    const bitmap = await createImageBitmap(blob);
    try {
        const scale = Math.min(1, COVER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Gambar cover tidak dapat diproses di peramban ini.');
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const webp = await canvasToBlob(canvas, 'image/webp', COVER_QUALITY);
        if (webp && webp.type === 'image/webp') return new File([webp], 'cover.webp', { type: 'image/webp' });

        // Cadangan: JPEG tidak mendukung transparansi, jadi beri latar putih.
        const flat = document.createElement('canvas');
        flat.width = canvas.width; flat.height = canvas.height;
        const flatContext = flat.getContext('2d');
        if (!flatContext) throw new Error('Gambar cover tidak dapat diproses di peramban ini.');
        flatContext.fillStyle = '#ffffff';
        flatContext.fillRect(0, 0, flat.width, flat.height);
        flatContext.drawImage(canvas, 0, 0);
        const jpeg = await canvasToBlob(flat, 'image/jpeg', 0.85);
        if (!jpeg) throw new Error('Gambar cover gagal dikompresi.');
        return new File([jpeg], 'cover.jpg', { type: 'image/jpeg' });
    } finally {
        bitmap.close();
    }
}
