import { resolvePublicOrigin } from '@/lib/public-origin';
import { extractRequestToken,verifyAppToken } from '@/lib/app-jwt';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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
function protectResponse(response: NextResponse, authRoute: boolean) {
    if (process.env.NODE_ENV === 'production') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (authRoute) response.headers.set('Cache-Control', 'private, no-store');
    return response;
}
export async function middleware(req: NextRequest) {
    const authRoute = req.nextUrl.pathname.startsWith('/api/auth/');
    const token = extractRequestToken(req);
    if (token && (await verifyAppToken(token))) {
        return protectResponse(NextResponse.next({ request: req }), authRoute);
    }

    if (req.nextUrl.pathname.startsWith('/dashboard')) {
        const base = resolvePublicOrigin(req);
        return protectResponse(NextResponse.redirect(new URL('/?error=cbt-session-unavailable', base)), true);
    }

    return protectResponse(NextResponse.next({ request: req }), authRoute);
}

export const config = {
    // Berlaku di semua rute kecuali berkas internal Next.js dan aset statis.
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
