/**
 * Penyaring URL untuk tautan yang isinya berasal dari pengguna.
 *
 * "Link Video" pada jawaban uraian adalah input bebas milik siswa dan
 * dirender sebagai <a href> di halaman penilaian guru. Tanpa filter,
 * `javascript:...` / `data:...` ikut lolos ke atribut href dan tereksekusi
 * di konteks halaman guru saat diklik.
 */
export function safeExternalUrl(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        return '';
    } catch {
        return '';
    }
}

/** True bila URL layak disimpan sebagai tautan (http/https). */
export function isSafeExternalUrl(raw: unknown): boolean {
    return safeExternalUrl(raw) !== '';
}

/**
 * Label lampiran dari URL storage.
 * decodeURIComponent melempar URIError pada urutan `%` ilegal — cukup satu
 * nama file aneh untuk merontokkan seluruh halaman penilaian.
 */
export function attachmentLabel(url: string, index: number): string {
    const raw = (url || '').split('?')[0].split('/').pop() || '';
    if (!raw) return `File ${index + 1}`;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * Memastikan string URL memiliki format absolut.
 * Jika URL berupa path relatif (mis. '/uploads/...'), ubah menjadi absolut
 * dengan memanfaatkan origin window saat ini di browser.
 */
export function ensureAbsoluteUrl(url: string): string {
    if (!url) return url;
    if (/^(https?:)?\/\//i.test(url)) return url;
    if (typeof window !== 'undefined' && url.startsWith('/')) {
        return `${window.location.origin}${url}`;
    }
    if (typeof window !== 'undefined') {
        return new URL(url, window.location.origin).toString();
    }
    return url;
}

/**
 * Normalisasi URL berkas penyimpanan Cloudflare R2 / local proxy.
 * Domain `*.r2.dev` diblokir di tingkat DNS oleh banyak ISP di Indonesia.
 * Fungsi ini mengubah URL `https://*.r2.dev/<key>` menjadi `/api/storage/file/<key>`
 * agar berkas dapat diakses secara lancar melalui internal proxy.
 */
export function resolveStorageUrl(url: string): string {
    if (!url) return '';
    // Jika URL adalah URL r2.dev, ubah menjadi relative /api/storage/file/
    const r2Match = url.match(/^https?:\/\/[^/]+\.r2\.dev\/(.+)$/i);
    if (r2Match) {
        return `/api/storage/file/${r2Match[1]}`;
    }
    return url;
}

/**
 * Normalisasi seluruh kemunculan URL r2.dev dalam teks HTML
 */
export function normalizeHtmlStorageUrls(html: string): string {
    if (!html) return '';
    return html.replace(/https?:\/\/[^/"]+\.r2\.dev\/([^"'\s>]+)/gi, '/api/storage/file/$1');
}

