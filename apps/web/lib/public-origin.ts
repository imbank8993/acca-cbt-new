import type { NextRequest } from 'next/server';

/** Only the reverse proxy may supply forwarded headers; deployment must overwrite them. */
export function requestPublicOrigin(request: NextRequest): string {
    const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host).split(',')[0].trim();
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    const protocol = request.nextUrl.protocol === 'https:' || forwarded === 'https' ? 'https:' : 'http:';
    if (!host || /[\s/@\\?#]/.test(host)) return request.nextUrl.origin;
    try { return new URL(`${protocol}//${host}`).origin; } catch { return request.nextUrl.origin; }
}

/** Production redirects must never downgrade to HTTP, even behind an HTTP upstream. */
export function resolvePublicOrigin(request: NextRequest): string {
    const incoming = requestPublicOrigin(request);
    if (process.env.NODE_ENV !== 'production') return incoming;
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const destination = new URL(configured || incoming);
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new Error('NEXT_PUBLIC_SITE_URL tidak valid.');
    destination.protocol = 'https:';
    return destination.origin;
}
