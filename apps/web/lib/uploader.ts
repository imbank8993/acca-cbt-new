import { getErrorMessage } from '@/lib/errors';
import { ensureAbsoluteUrl, resolveStorageUrl } from '@/lib/safe-url';

/**
 * Helper untuk upload dan delete file
 * Mendukung multiple storage provider (Supabase, Cloudflare R2)
 * Provider aktif dikonfigurasi di ACCA Hub → Settings → Penyimpanan
 *
 * Semua operasi lewat /api/storage/upload (POST untuk unggah, DELETE untuk
 * hapus). Jalur langsung dari browser ke Supabase sudah dihapus karena
 * melewati validasi ekstensi/ukuran/kepemilikan folder di server.
 */

const STORAGE_ENDPOINT = '/api/storage/upload';

interface UploadResponse {
    success?: boolean;
    url?: string;
    error?: string;
    provider?: string;
}

/**
 * Upload file ke storage provider yang aktif.
 *
 * @param file Objek file yang akan diunggah
 * @param folder Folder penyimpanan (cth: avatars, questions)
 * @param oldFileUrl (Opsional) URL file lama yg akan dihapus setelah sukses
 * @returns { success: boolean, url?: string, error?: string }
 */
export async function uploadToHosting(
    file: File,
    folder: string = 'misc',
    oldFileUrl: string = ''
): Promise<{ success: boolean; url?: string; error?: string; provider?: string }> {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', folder);

        const resp = await fetch(STORAGE_ENDPOINT, {
            method: 'POST',
            body: formData,
        });

        // Body bisa bukan JSON (mis. 413 dari reverse-proxy/platform hosting
        // saat file melebihi batas request). Tanpa penanganan ini, resp.json()
        // melempar dan pesan yang sampai ke pengguna tidak informatif.
        let result: UploadResponse | null = null;
        try {
            result = await resp.json() as UploadResponse;
        } catch {
            if (resp.status === 413) {
                return { success: false, error: 'File terlalu besar untuk diunggah. Coba kompres atau gunakan file yang lebih kecil.' };
            }
            return { success: false, error: `Server menolak unggahan (HTTP ${resp.status}).` };
        }

        if (!resp.ok || !result?.success) {
            const error = result?.error || `Gagal mengunggah (HTTP ${resp.status}).`;
            console.error('[uploadToHosting] Upload failed:', error);
            return { success: false, error };
        }

        // Hapus file lama hanya setelah file baru berhasil tersimpan.
        if (oldFileUrl) {
            deleteFromHosting(oldFileUrl).catch(() => {});
        }

        return {
            success: true,
            url: ensureAbsoluteUrl(resolveStorageUrl(result.url || '')),
            provider: result.provider,
        };
    } catch (err) {
        console.error('[uploadToHosting] Exception during upload:', getErrorMessage(err));
        return { success: false, error: getErrorMessage(err) || 'Koneksi terputus saat mengunggah file.' };
    }
}

/**
 * Hapus file dari provider aktif (Supabase atau R2) lewat API route.
 * @param fileUrl URL publik file yang akan dihapus
 */
export async function deleteFromHosting(fileUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!fileUrl || (!fileUrl.startsWith('http') && !fileUrl.startsWith('/api/storage/file/'))) return { success: false };

    try {
        const resp = await fetch(STORAGE_ENDPOINT, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: fileUrl }),
        });
        const result = await resp.json().catch(() => null);
        if (!resp.ok || !result?.success) {
            const error = result?.error || `HTTP ${resp.status}`;
            console.warn('[deleteFromHosting] Could not delete:', error);
            return { success: false, error };
        }
        return { success: true };
    } catch (err) {
        console.warn('[deleteFromHosting] Could not delete:', err);
        return { success: false, error: getErrorMessage(err) };
    }
}
