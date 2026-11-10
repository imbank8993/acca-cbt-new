/**
 * Perkecil dan ubah gambar soal ke WebP sebelum diunggah.
 *
 * Gambar soal tampil paling lebar ±800 px, jadi sisi terpanjang dibatasi
 * 1600 px (tetap tajam di layar retina). Foto memakai kualitas 85%, gambar
 * PNG/diagram 92% agar garis dan tulisan tetap tajam; transparansi dipertahankan.
 *
 * Dibiarkan apa adanya: SVG (persamaan), GIF, PNG/WebP beranimasi, gambar kecil
 * yang tidak perlu diperkecil, dan hasil konversi yang tidak lebih kecil.
 * Peramban yang tidak bisa membuat WebP (mis. Safari lama) mendapat JPEG, atau
 * PNG bila gambarnya transparan.
 */

export const QUESTION_IMAGE_MAX_SIDE = 1600;
export const QUESTION_PHOTO_QUALITY = 0.85;
export const QUESTION_GRAPHIC_QUALITY = 0.92;
/** Gambar sekecil ini yang tidak perlu diperkecil dibiarkan; keuntungannya tidak sepadan. */
export const QUESTION_IMAGE_SMALL_BYTES = 150 * 1024;

const CONVERTIBLE = /^image\/(jpeg|jpg|pjpeg|png|webp|bmp)$/i;
const PHOTO = /^image\/(jpeg|jpg|pjpeg)$/i;

export type QuestionImagePlan =
    | { action: 'keep'; reason: 'format' | 'small' }
    | { action: 'convert'; width: number; height: number; quality: number; resized: boolean };

/** Keputusan murni (dapat diuji tanpa peramban). */
export function planQuestionImage(input: { type: string; size: number; width: number; height: number }): QuestionImagePlan {
    if (!CONVERTIBLE.test(input.type || '')) return { action: 'keep', reason: 'format' };
    const longest = Math.max(input.width, input.height);
    const scale = longest > QUESTION_IMAGE_MAX_SIDE ? QUESTION_IMAGE_MAX_SIDE / longest : 1;
    const resized = scale < 1;
    if (!resized && input.size <= QUESTION_IMAGE_SMALL_BYTES && !/bmp/i.test(input.type)) return { action: 'keep', reason: 'small' };
    return {
        action: 'convert',
        width: Math.max(1, Math.round(input.width * scale)),
        height: Math.max(1, Math.round(input.height * scale)),
        quality: PHOTO.test(input.type) ? QUESTION_PHOTO_QUALITY : QUESTION_GRAPHIC_QUALITY,
        resized,
    };
}

/** Pakai hasil konversi hanya bila memang lebih kecil (atau resolusinya diperkecil). */
export function preferConverted(originalBytes: number, convertedBytes: number, resized: boolean): boolean {
    // Resolusi diperkecil: hasilnya dipakai walau berkas asli kebetulan lebih kecil (mis. PNG sederhana).
    if (resized) return convertedBytes > 0;
    return convertedBytes > 0 && convertedBytes < originalBytes * 0.95;
}

/** PNG (acTL) dan WebP (ANIM) beranimasi ditandai di awal berkas. */
export function isAnimatedImageHeader(bytes: Uint8Array, type: string): boolean {
    const marker = /png/i.test(type) ? 'acTL' : /webp/i.test(type) ? 'ANIM' : '';
    if (!marker) return false;
    const limit = Math.min(bytes.length, 4096);
    outer: for (let i = 0; i + 4 <= limit; i++) {
        for (let j = 0; j < 4; j++) if (bytes[i + j] !== marker.charCodeAt(j)) continue outer;
        return true;
    }
    return false;
}

export function renameExtension(name: string, extension: string): string {
    const base = (name || 'gambar-soal').replace(/\.[a-z0-9]{1,5}$/i, '');
    return `${base || 'gambar-soal'}.${extension}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
    const data = context.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
}

/** Hanya berjalan di peramban; di luar itu (atau bila gagal) berkas asli dikembalikan. */
export async function optimizeQuestionImage(file: File): Promise<File> {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
    if (!CONVERTIBLE.test(file.type || '')) return file;
    try {
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        if (isAnimatedImageHeader(head, file.type)) return file;
    } catch {
        return file;
    }

    let bitmap: ImageBitmap;
    try {
        // Orientasi EXIF foto HP diterapkan, jadi hasilnya tidak terbalik.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return file;
    }
    try {
        const plan = planQuestionImage({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
        if (plan.action === 'keep') return file;

        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return file;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, plan.width, plan.height);
        const transparent = !PHOTO.test(file.type) && hasTransparency(context, plan.width, plan.height);

        let blob = await canvasToBlob(canvas, 'image/webp', plan.quality);
        let extension = 'webp';
        if (!blob || blob.type !== 'image/webp') {
            if (transparent) {
                blob = await canvasToBlob(canvas, 'image/png');
                extension = 'png';
            } else {
                // JPEG tidak punya transparansi: latar putih, bukan hitam.
                const flat = document.createElement('canvas');
                flat.width = plan.width;
                flat.height = plan.height;
                const flatContext = flat.getContext('2d');
                if (!flatContext) return file;
                flatContext.fillStyle = '#ffffff';
                flatContext.fillRect(0, 0, flat.width, flat.height);
                flatContext.drawImage(canvas, 0, 0);
                blob = await canvasToBlob(flat, 'image/jpeg', QUESTION_PHOTO_QUALITY);
                extension = 'jpg';
            }
        }
        if (!blob || !preferConverted(file.size, blob.size, plan.resized)) return file;
        return new File([blob], renameExtension(file.name, extension), { type: blob.type, lastModified: Date.now() });
    } catch {
        return file;
    } finally {
        bitmap.close();
    }
}
