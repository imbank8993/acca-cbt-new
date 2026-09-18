/**
 * Klien HTTP untuk route handler Next.js sendiri (same-origin).
 *
 * Seluruh berkas di `lib/api/` memakai helper ini. Ia menggantikan pemanggilan
 * server action dari komponen, mengikuti pola acca-new: browser berbicara dengan
 * Next.js lewat `fetch('/api/…')`, dan Next.js yang meneruskan ke NestJS.
 *
 * Token TIDAK pernah disentuh di sini. Ia ada di cookie httpOnly dan dikirim
 * otomatis oleh browser karena permintaannya same-origin.
 */

export interface ApiFailure {
    success: false;
    error: string;
}

export type ApiResult<T> = ({ success: true } & T) | ApiFailure;

async function request<T>(
    path: string,
    init: RequestInit = {},
): Promise<ApiResult<T>> {
    try {
        const response = await fetch(path, {
            ...init,
            headers: {
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...((init.headers as Record<string, string>) || {}),
            },
            // Data CBT berubah terus (jawaban, status ujian, pemantauan).
            // Jawaban yang di-cache di sini akan menampilkan keadaan basi pada
            // layar yang justru paling bergantung pada kebaruan.
            cache: 'no-store',
        });

        let body: unknown = null;
        const text = await response.text();
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                // Balasan bukan-JSON biasanya dari reverse proxy, mis. 413 saat
                // unggahan melebihi batas. Pesannya dibuat jelas alih-alih
                // melempar SyntaxError yang menyesatkan.
                return {
                    success: false,
                    error:
                        response.status === 413
                            ? 'Data terlalu besar untuk dikirim.'
                            : `Server membalas dengan status ${response.status}.`,
                };
            }
        }

        const record = (body || {}) as Record<string, unknown>;

        if (!response.ok || record.success === false) {
            return {
                success: false,
                error: (record.error as string) || `Permintaan gagal (HTTP ${response.status}).`,
            };
        }

        return record as ApiResult<T>;
    } catch (error) {
        // Termasuk saat perangkat kehilangan jaringan di tengah ujian.
        return {
            success: false,
            error: (error as Error).message || 'Tidak dapat menghubungi server.',
        };
    }
}

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
    return request<T>(path, { method: 'GET' });
}

export function apiSend<T>(
    path: string,
    body: unknown,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
): Promise<ApiResult<T>> {
    return request<T>(path, { method, body: JSON.stringify(body) });
}
