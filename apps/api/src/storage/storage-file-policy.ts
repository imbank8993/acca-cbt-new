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

/** Only explicitly public branding/profile folders bypass authentication. Unknown folders are private. */
export function isPublicFile(key: string): boolean {
    return /^(?:users\/[^/]+\/)?(?:avatars|logos|branding)\//.test(key);
}
