export const SCREENSHOT_MAX_BYTES = 200 * 1024;
export const SCREENSHOT_MAX_COUNT = 10;
export const SCREENSHOT_COOLDOWN_MS = 30_000;

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
export async function encodeScreenFrame(video: HTMLVideoElement): Promise<Blob> {
    if (!video.videoWidth || !video.videoHeight) throw new Error('Gambar layar belum tersedia.');
    const canvas = document.createElement('canvas');
    for (const width of [1600, 1280, 1024]) {
        const scale = Math.min(1, width / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser tidak mendukung pengambilan gambar layar.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
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
