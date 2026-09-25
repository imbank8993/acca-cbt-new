import { NextRequest, NextResponse } from 'next/server';
import { encodeSessionCookie, SESSION_COOKIE, sessionCookieOptions } from '@/lib/app-jwt';
import { nestFetchInternal } from '@/lib/nest-api';

const TWELVE_HOURS = 12 * 60 * 60;

/**
 * Pintu masuk tunggal ke CBT.
 *
 * CBT TIDAK punya halaman login. Pengguna masuk di acca-new, dan acca-new
 * mengarahkan ke sini: `GET /api/auth/sso?token=…`, dengan tiket JWT berumur
 * 5 menit yang ditandatangani `CBT_SSO_SECRET` (lihat
 * `apps/web/app/api/sso/cbt/route.ts` di acca-new). Jalur itulah yang sudah
 * terpasang di produksi, jadi alamatnya dipertahankan persis.
 *
 * Versi sebelumnya di berkas ini menukar tiket tersebut dengan magic link
 * Supabase lalu menyerahkan access + refresh token lewat fragment URL agar
 * dipungut klien Supabase di browser. Rangkaian itu punya dua masalah:
 *
 *  1. Ia bergantung penuh pada Supabase Auth — yang sudah tidak ada lagi
 *     setelah pindah ke PostgreSQL murni, sehingga seluruh alur masuk akan
 *     berhenti bekerja.
 *  2. Kedua aplikasi menggerakkan SATU keluarga refresh token. Supabase
 *     merotasinya setiap kali dipakai, jadi aplikasi yang menyegarkan
 *     belakangan menyodorkan token yang sudah dikonsumsi, keluarganya dicabut,
 *     dan salah satu sisi kehilangan sesinya. Bila itu terjadi di tengah ujian,
 *     seluruh autosave jawaban ikut ditolak — inilah "Sesi tidak ditemukan"
 *     yang dulu hanya sembuh dengan berpindah perangkat.
 *
 * Sekarang: NestJS yang memverifikasi tiket, menyamakan peran, lalu menerbitkan
 * JWT CBT sendiri. Token itu masuk ke cookie httpOnly. Tidak ada token di URL,
 * tidak ada keluarga refresh token bersama, dan tidak ada Supabase.
 */
function resolvePublicOrigin(request: NextRequest): string {
    // 1. Cek header reverse proxy (Nginx / Traefik / Cloudflare)
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    if (forwardedHost && !forwardedHost.includes('0.0.0.0') && !forwardedHost.startsWith('127.') && !forwardedHost.endsWith(':3008')) {
        return `${forwardedProto}://${forwardedHost}`;
    }

    // 2. Cek variabel lingkungan NEXT_PUBLIC_SITE_URL (misal https://accav2-cbt.icgowa.sch.id di VPS)
    const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (envSiteUrl && !envSiteUrl.includes('0.0.0.0') && (envSiteUrl.startsWith('https://') || !envSiteUrl.includes('localhost'))) {
        return envSiteUrl.replace(/\/$/, '');
    }

    // 3. Cek header host standar jika berupa domain publik
    const host = request.headers.get('host');
    if (host && !host.includes('0.0.0.0') && !host.startsWith('127.') && !host.endsWith(':3008')) {
        const proto = request.headers.get('x-forwarded-proto') || 'https';
        return `${proto}://${host}`;
    }

    // 4. Fallback ke NEXT_PUBLIC_SITE_URL apa pun yang valid
    if (envSiteUrl && !envSiteUrl.includes('0.0.0.0')) {
        return envSiteUrl.replace(/\/$/, '');
    }

    // 5. Fallback lokal untuk dev
    const origin = request.nextUrl.origin;
    if (origin.includes('0.0.0.0') || origin.includes('127.0.0.1')) {
        return 'http://localhost:3008';
    }
    return origin;
}

export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');
    const origin = resolvePublicOrigin(request);

    if (!token) {
        return NextResponse.redirect(new URL('/?error=missing-token', origin));
    }

    const { status, body } = await nestFetchInternal<{
        access_token?: string;
        user?: { bestRole?: string };
        error?: string;
        message?: string;
    }>('/auth/sso', { method: 'POST', body: JSON.stringify({ token }) });

    if (status !== 200 || !body?.access_token) {
        const message = body?.error || body?.message || 'Tiket SSO tidak valid.';
        return NextResponse.redirect(
            new URL(`/?error=invalid-token&msg=${encodeURIComponent(message)}`, origin),
        );
    }

    // Peran diteruskan sebagai parameter agar halaman depan bisa langsung
    // mengarahkan ke dasbor yang tepat tanpa menunggu pencarian peran — penyebab
    // utama jeda panjang "Memeriksa akses…" pada alur lama.
    const role = encodeURIComponent(body.user?.bestRole || '');
    const response = NextResponse.redirect(new URL(`/?sso_role=${role}`, origin));

    response.cookies.set(
        SESSION_COOKIE,
        encodeSessionCookie(body.access_token),
        sessionCookieOptions(TWELVE_HOURS),
    );
    return response;
}
