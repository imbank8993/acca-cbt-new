/**
 * Logo sekolah untuk kop dokumen.
 *
 * `profil_sekolah.logo_url` dapat menunjuk ke bucket aplikasi ini atau ke
 * host luar (mis. aplikasi induk). Browser tidak dapat menyematkan logo dari
 * host luar ke PDF/kanvas bila host itu tidak mengirim header CORS, sehingga
 * kop tercetak tanpa logo. Server mengambilkannya dan menyajikannya dari
 * origin aplikasi.
 */

export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const LOGO_TYPES = /^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i;

export function isLogoContentType(contentType: string | null | undefined): boolean {
    return LOGO_TYPES.test((contentType || '').split(';')[0].trim());
}

type LogoRow = { logo_url?: string | null } | null;
type LogoQuery = { data: unknown; error?: unknown };

/** Logo profil sekolah lebih dulu, lalu logo organisasi — sama dengan sumber kop di API PAS. */
export function pickSchoolLogoUrl(profile: LogoQuery, organization: LogoQuery): string {
    const fromProfile = (profile.data as LogoRow)?.logo_url?.trim();
    if (fromProfile) return fromProfile;
    return (organization.data as LogoRow)?.logo_url?.trim() || '';
}

export interface FetchedLogo { body: Buffer; contentType: string }

/** Ambil logo dari host luar: hanya http(s), hanya gambar, maksimal 3 MB, batas waktu 8 detik. */
export async function fetchExternalLogo(
    url: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 8000,
): Promise<FetchedLogo | null> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(parsed.href, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { Accept: 'image/*' },
        });
        if (!response.ok) return null;
        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!isLogoContentType(contentType)) return null;
        if (Number(response.headers.get('content-length') || 0) > MAX_LOGO_BYTES) return null;
        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length || body.length > MAX_LOGO_BYTES) return null;
        return { body, contentType };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
