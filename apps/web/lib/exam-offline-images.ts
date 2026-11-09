/**
 * Alamat gambar soal yang perlu disimpan service worker agar tetap tampil saat
 * jaringan siswa terputus. Gambar base64 sudah ikut tersimpan bersama soal;
 * gambar berkas (/api/storage/file/...) perlu diunduh lebih dulu saat online.
 *
 * Hanya gambar: audio/video berukuran besar dan diputar lewat Range request,
 * jadi sengaja tidak disimpan.
 */

const STORAGE_URL = /(?:https?:\/\/[^\s"'<>()]+)?\/api\/storage\/file\/[^\s"'<>()]+/gi;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;

function walkStrings(value: unknown, visit: (text: string) => void): void {
    if (typeof value === 'string') { if (value.includes('/api/storage/file/')) visit(value); return; }
    if (Array.isArray(value)) { for (const item of value) walkStrings(item, visit); return; }
    if (value && typeof value === 'object') for (const item of Object.values(value)) walkStrings(item, visit);
}

/** URL absolut (origin sama) semua gambar berkas di dalam data soal, tanpa duplikat. */
export function examImageUrls(questions: unknown, origin: string): string[] {
    const found = new Set<string>();
    walkStrings(questions, text => {
        for (const match of text.replace(/&amp;/g, '&').matchAll(STORAGE_URL)) {
            try {
                const url = new URL(match[0], origin);
                if (url.origin !== origin) continue;
                url.hash = '';
                if (!IMAGE_PATH.test(url.pathname)) continue;
                found.add(url.href);
            } catch {
                // Alamat rusak diabaikan; soal tetap tampil seperti biasa.
            }
        }
    });
    return [...found];
}
