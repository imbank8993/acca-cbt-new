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
    /** Respons mungkin hilang setelah server sempat memproses permintaan. */
    retryable?: boolean;
}

export type ApiResult<T> = ({ success: true } & T) | ApiFailure;

export interface ApiRequestOptions {
    timeoutMs?: number;
}

/** Batas tunggu baca agar halaman tidak terjebak loading tanpa akhir. */
export const DEFAULT_GET_TIMEOUT_MS = 15_000;
/** Batas tunggu mutasi yang memakai kunci retry-safe. */
export const DEFAULT_CREATE_TIMEOUT_MS = 20_000;

async function request<T>(
    path: string,
    init: RequestInit = {},
    options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
    const controller = options.timeoutMs ? new AbortController() : null;
    const timeout = controller
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : null;

    try {
        const response = await fetch(path, {
            ...init,
            signal: controller?.signal ?? init.signal,
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
                    retryable: response.status >= 500 || response.status === 408 || response.status === 429,
                };
            }
        }

        const record = (body || {}) as Record<string, unknown>;

        if (!response.ok || record.success === false) {
            return {
                success: false,
                error: (record.error as string) || `Permintaan gagal (HTTP ${response.status}).`,
                retryable: response.status >= 500 || response.status === 408 || response.status === 429,
            };
        }

        return record as ApiResult<T>;
    } catch (error) {
        // Termasuk saat perangkat kehilangan jaringan di tengah ujian.
        return {
            success: false,
            error: controller?.signal.aborted
                ? 'Server tidak merespons dalam batas waktu. Silakan coba lagi.'
                : ((error as Error).message || 'Tidak dapat menghubungi server.'),
            retryable: true,
        };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function apiGet<T>(
    path: string,
    options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
    return request<T>(path, { method: 'GET' }, {
        timeoutMs: options.timeoutMs ?? DEFAULT_GET_TIMEOUT_MS,
    });
}

export function apiSend<T>(
    path: string,
    body: unknown,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
    options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
    return request<T>(path, { method, body: JSON.stringify(body) }, options);
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function shortHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function createUuidV4(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface StoredCreateRequest {
    fingerprint: string;
    id: string;
}

function createRequestKey(path: string, body: object): {
    storageKey: string;
    fingerprint: string;
} {
    const fingerprint = canonicalJson({ path, body });
    return {
        storageKey: `acca:create-request:${shortHash(fingerprint)}`,
        fingerprint,
    };
}

function readOrCreateRequestId(path: string, body: object): {
    id: string;
    storageKey: string | null;
} {
    const { storageKey, fingerprint } = createRequestKey(path, body);
    if (typeof sessionStorage === 'undefined') return { id: createUuidV4(), storageKey: null };

    try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as StoredCreateRequest | null;
        if (stored?.fingerprint === fingerprint && stored.id) {
            return { id: stored.id, storageKey };
        }
        const id = createUuidV4();
        sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, id } satisfies StoredCreateRequest));
        return { id, storageKey };
    } catch {
        return { id: createUuidV4(), storageKey: null };
    }
}

/**
 * POST pembuatan yang aman diulang setelah timeout atau jaringan putus.
 * Kunci dipertahankan hanya bila hasil akhirnya masih ambigu.
 */
export async function apiCreate<T>(
    path: string,
    body: object,
    options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
    return apiIdempotentMutation(path, body, 'POST', options);
}

/** Mutasi create retry-safe untuk endpoint legacy yang memakai PUT. */
export async function apiIdempotentMutation<T>(
    path: string,
    body: object,
    method: 'POST' | 'PUT' = 'POST',
    options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
    const pending = readOrCreateRequestId(`${method}:${path}`, body);
    const result = await request<T>(
        path,
        {
            method,
            body: JSON.stringify({ ...body, clientRequestId: pending.id }),
        },
        { timeoutMs: options.timeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS },
    );

    if ((result.success || !result.retryable) && pending.storageKey) {
        try {
            sessionStorage.removeItem(pending.storageKey);
        } catch {
            // Penyimpanan browser boleh ditolak; hasil HTTP tetap sah.
        }
    }
    return result;
}
