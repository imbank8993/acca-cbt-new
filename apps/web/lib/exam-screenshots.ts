export const SCREENSHOT_MAX_BYTES = 200 * 1024;
export const SCREENSHOT_MAX_COUNT = 10;
export const SCREENSHOT_COOLDOWN_MS = 30_000;
/** Toleransi sebelum terputusnya berbagi layar dihitung sebagai pelanggaran. */
export const SCREEN_SHARE_GRACE_MS = 30_000;
/** Mengunci layar memutus berbagi layar dan fokus hampir bersamaan; jangan hitung dobel. */
export const SCREEN_SHARE_RACE_MS = 3_000;
export const SCREEN_SHARE_LOST_EVENT = 'cbt:screen-share-lost';
/**
 * Jeda sebelum frame diambil. Saat event blur/visibilitychange terjadi, sistem
 * operasi belum selesai menggambar jendela tujuan dan stream layar masih
 * memegang frame lama, sehingga screenshot seketika hampir selalu hanya
 * memperlihatkan halaman ujian itu sendiri.
 */
export const SCREENSHOT_CAPTURE_DELAY_MS = 700;

type FrameSource = { source: CanvasImageSource; width: number; height: number; release?: () => void };

/**
 * Ambil frame TERBARU dari track. `ImageCapture.grabFrame()` membaca langsung
 * dari stream; elemen video di tab tersembunyi bisa dibekukan browser pada
 * frame terakhir yang dirender.
 */
export async function latestScreenFrame(video: HTMLVideoElement, track?: MediaStreamTrack | null): Promise<FrameSource> {
    const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
    if (track && track.readyState === 'live' && ImageCaptureCtor) {
        try {
            const bitmap = await new ImageCaptureCtor(track).grabFrame();
            return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
        } catch { /* fallback ke elemen video */ }
    }
    return { source: video, width: video.videoWidth, height: video.videoHeight };
}

/** Reuse the same event and payload: a lost response must not duplicate evidence. */
export async function sendScreenshotWithRetry<T extends { success: boolean; retryable?: boolean }>(
    send: () => Promise<T>,
    wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            const result = await send();
            if (result.success || !result.retryable || attempt >= 2) return result;
        } catch (error) {
            if (attempt >= 2) throw error;
        }
        await wait(1000 * (attempt + 1));
    }
}

/** Keep small text readable, reducing dimensions only when quality alone is insufficient. */
export async function encodeScreenFrame(video: HTMLVideoElement | FrameSource): Promise<Blob> {
    const input: FrameSource = 'source' in video ? video : { source: video, width: video.videoWidth, height: video.videoHeight };
    try { return await encodeFrame(input); }
    finally { input.release?.(); }
}

async function encodeFrame(input: FrameSource): Promise<Blob> {
    if (!input.width || !input.height) throw new Error('Gambar layar belum tersedia.');
    // Freeze the frame before the first async encoding step. Finishing the exam
    // can stop/detach the live video while smaller encodings are still pending.
    const frame = document.createElement('canvas');
    const frameScale = Math.min(1, 1600 / input.width);
    frame.width = Math.max(1, Math.round(input.width * frameScale));
    frame.height = Math.max(1, Math.round(input.height * frameScale));
    const frameContext = frame.getContext('2d');
    if (!frameContext) throw new Error('Browser tidak mendukung pengambilan gambar layar.');
    frameContext.drawImage(input.source, 0, 0, frame.width, frame.height);
    const canvas = document.createElement('canvas');
    for (const width of [1600, 1280, 1024]) {
        const scale = Math.min(1, width / frame.width);
        canvas.width = Math.max(1, Math.round(frame.width * scale));
        canvas.height = Math.max(1, Math.round(frame.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser tidak mendukung pengambilan gambar layar.');
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.8, 0.65, 0.5]) {
            for (const mime of ['image/webp', 'image/jpeg']) {
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
                if (blob && blob.type === mime && blob.size <= SCREENSHOT_MAX_BYTES) return blob;
            }
        }
    }
    throw new Error('Gambar layar tidak dapat diperkecil hingga 200 KB.');
}

export async function screenshotBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}
