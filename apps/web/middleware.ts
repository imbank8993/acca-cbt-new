import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { extractRequestToken, verifyAppToken } from '@/lib/app-jwt';

/**
 * Penjaga sesi. Satu jalur: cookie `cbt_session` berisi JWT terbitan NestJS.
 *
 * Jalur Supabase yang dulu berdampingan di sini sudah dibuang bersama cutover
 * 16 September 2026. Ia bukan sekadar mati — ia melubangi penjaganya: setiap
 * permintaan ke `/dashboard` dengan token kedaluwarsa jatuh ke pemeriksaan
 * Supabase, pemanggilannya melempar karena servernya tidak ada lagi, dan
 * `catch` yang memang dibuat agar penyegaran sesi tidak pernah memblokir
 * permintaan justru **meloloskan** permintaan itu.
 *
 * Klaim `role` di dalam token tidak diperiksa di sini: middleware hanya
 * menentukan "ada sesi sah atau tidak". Setiap keputusan otorisasi dibuat
 * NestJS, yang membaca ulang peran dari database pada tiap permintaan.
 */
export async function middleware(req: NextRequest) {
    const token = extractRequestToken(req);
    if (token && (await verifyAppToken(token))) {
        return NextResponse.next({ request: req });
    }

    if (req.nextUrl.pathname.startsWith('/dashboard')) {
        const forwardedHost = req.headers.get('x-forwarded-host');
        const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
        const base = (forwardedHost && !forwardedHost.includes('0.0.0.0') && !forwardedHost.endsWith(':3008'))
            ? `${forwardedProto}://${forwardedHost}`
            : (siteUrl && !siteUrl.includes('0.0.0.0') ? siteUrl : req.url);
        return NextResponse.redirect(new URL('/', base));
    }

    return NextResponse.next({ request: req });
}

export const config = {
    // Berlaku di semua rute kecuali berkas internal Next.js dan aset statis.
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
