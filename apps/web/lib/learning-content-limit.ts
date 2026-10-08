// Multer rejects fields at its 8 MiB limit.
export const MAX_LEARNING_HTML_BYTES = 8 * 1024 * 1024 - 1;

export function assertLearningContentSize(html: string): void {
    if (html.length > 6_000_000 || new TextEncoder().encode(html).length > MAX_LEARNING_HTML_BYTES) {
        throw new Error('Isi materi terlalu besar (maksimum 6 juta karakter dan kurang dari 8 MB). Kurangi gambar atau pecah materi menjadi beberapa bagian.');
    }
}
