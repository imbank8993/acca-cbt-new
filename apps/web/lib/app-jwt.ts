/**
 * Verifikasi token JWT terbitan backend NestJS (bukan lagi Supabase Auth).
 *
 * Dipakai di `middleware.ts` (runtime Edge) maupun route handler (Node) —
 * `jose` bekerja di keduanya, sementara `jsonwebtoken` tidak.
 *
 * Token TIDAK PERNAH dibaca JavaScript browser: ia disimpan di cookie httpOnly
 * dan hanya dibuka di sisi server. Itulah yang membuat `navigator.sendBeacon`
 * pada penyimpanan jawaban terakhir tetap berfungsi — permintaannya same-origin
 * ke Next.js dan cookie ikut terkirim otomatis, tanpa preflight CORS yang
 * memang tidak didukung sendBeacon.
 */

import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');

/** Nama cookie sesi CBT. Terpisah dari `acca_session` milik acca-new. */
export const SESSION_COOKIE = 'cbt_session';
export const SECURE_SESSION_COOKIE = '__Host-cbt_session';
export function sessionCookieName(): string {
    return process.env.NODE_ENV === 'production' ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

export interface AppJwtPayload {
    sub: string;
    /** UUID `auth.users.id` — identitas yang dirujuk `cbt_profiles.id`. */
    authId: string | null;
    email: string | null;
    /** Petunjuk peran dari token. JANGAN dipakai untuk otorisasi. */
    role: string | null;
}

/**
 * Verifikasi tanda tangan dan masa berlaku token.
 *
 * Klaim `role` di dalam token hanya petunjuk untuk pengarahan halaman di
 * middleware. Setiap keputusan otorisasi dibuat NestJS, yang membaca ulang peran
 * dari database pada tiap permintaan — token yang dirakit sendiri tidak bisa
 * menaikkan hak akses.
 */
export async function verifyAppToken(token: string): Promise<AppJwtPayload | null> {
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token, secret);
        if (!payload.sub) return null;
        return {
            sub: String(payload.sub),
            authId: (payload.authId as string) ?? null,
            email: (payload.email as string) ?? null,
            role: (payload.role as string) ?? null,
        };
    } catch {
        return null;
    }
}

export function encodeSessionCookie(token: string): string {
    const encoded =
        typeof Buffer !== 'undefined'
            ? Buffer.from(token).toString('base64url')
            : btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `base64-${encoded}`;
}

export function decodeSessionCookie(raw: string): string {
    if (!raw) return '';
    if (!raw.startsWith('base64-')) return raw;
    try {
        const encoded = raw.slice(7);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(encoded, 'base64url').toString('utf-8');
        }
        const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    } catch {
        return '';
    }
}

/**
 * Ambil token pemanggil dari permintaan.
 *
 * Cookie diperiksa LEBIH DULU daripada header Authorization: browser mengirim
 * cookie otomatis untuk semua route handler, sedangkan header bisa saja masih
 * berisi token Supabase lama dari kode yang belum dimigrasikan. Mendahulukan
 * header akan membuat permintaan yang sebenarnya sah ditolak 401.
 */
export function extractRequestToken(request: {
    headers: Headers;
    cookies?: { get: (name: string) => { value: string } | undefined };
}): string {
    if (request.cookies) {
        const token = decodeSessionCookie(request.cookies.get(SECURE_SESSION_COOKIE)?.value || request.cookies.get(SESSION_COOKIE)?.value || '');
        if (token) return token;
    }

    const header = request.headers.get('authorization') || '';
    if (header.toLowerCase().startsWith('bearer ')) {
        const token = header.slice(7).trim();
        if (token) return token;
    }

    return '';
}

/** Opsi cookie sesi. Dipakai saat menerbitkan maupun menghapus sesi. */
export function sessionCookieOptions(maxAgeSeconds: number) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // 'lax' memperbolehkan cookie ikut pada navigasi tingkat atas, yang
        // dibutuhkan pengalihan kembali dari acca-app setelah SSO.
        sameSite: 'lax' as const,
        path: '/',
        maxAge: maxAgeSeconds,
    };
}
