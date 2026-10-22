import { BadRequestException } from '@nestjs/common';

export function fileKey(url: string): string {
    const marker = '/storage/file/';
    const index = url.indexOf(marker);
    if (index < 0) throw new BadRequestException('Object key tidak valid.');
    let key: string;
    try { key = decodeURIComponent(url.slice(index + marker.length).split('?')[0]); }
    catch { throw new BadRequestException('Object key tidak valid.'); }
    if (!key || key.includes('\\') || key.includes('%') || key.split('/').some(s => !s || s === '.' || s === '..')) {
        throw new BadRequestException('Object key tidak valid.');
    }
    return key;
}

/** Content types a browser may render inline. Everything else is forced to download. */
const INLINE_TYPES = /^(?:image\/(?:jpeg|png|gif|webp|bmp|svg\+xml)|application\/pdf|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/plain|text\/csv)$/i;

/**
 * Header penyajian berkas unggahan.
 *
 * Berkas disajikan dari origin aplikasi, jadi berkas aktif (SVG/HTML) yang
 * dibuka langsung di tab bisa menjalankan skrip dengan sesi pengguna yang
 * membukanya. `sandbox` mematikan skrip dan memberi origin unik; PDF
 * dikecualikan karena penampil PDF Chrome menolak dokumen ber-sandbox.
 */
export function fileServingHeaders(contentType: string): Record<string, string> {
    const type = (contentType || '').split(';')[0].trim().toLowerCase();
    const headers: Record<string, string> = {
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (type !== 'application/pdf') {
        headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
    }
    if (!INLINE_TYPES.test(type)) headers['Content-Disposition'] = 'attachment';
    return headers;
}

/** SVG dapat membawa skrip; hanya staf dan layanan internal yang boleh mengunggahnya. */
export function canUploadSvg(user: { roles?: string[]; isPlatformAdmin?: boolean; resolved?: { superadmin?: boolean } } | null): boolean {
    if (!user) return true;
    return Boolean(user.isPlatformAdmin || user.resolved?.superadmin ||
        (user.roles || []).some(role => ['ADMIN', 'PROKTOR', 'GURU'].includes(String(role).toUpperCase())));
}

/** Only explicitly public branding/profile folders bypass authentication. Unknown folders are private. */
export function isPublicFile(key: string): boolean {
    return /^(?:users\/[^/]+\/)?(?:avatars|logos|branding)\//.test(key);
}
