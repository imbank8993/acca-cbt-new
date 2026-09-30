import { SESSION_COOKIE,sessionCookieOptions } from '@/lib/app-jwt';
import { NextResponse } from 'next/server';

function clearSession(response: NextResponse): NextResponse {
    // Opsi lainnya harus sama persis dengan saat cookie diterbitkan, jika
    // tidak browser membuat cookie kedua alih-alih menimpa yang lama.
    response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
    return response;
}

export async function POST() {
    const response = NextResponse.json({ success: true });
    return clearSession(response);
}

/**
 * Front-channel logout callback untuk ACCA New. Setelah menghapus sesi ACCA
 * New, arahkan browser ke endpoint ini agar cookie host-only CBT juga dihapus.
 */
export async function GET() {
    const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';
    const destination = new URL('/login?logged_out=1', accaUrl);
    const response = NextResponse.redirect(destination);
    response.headers.set('Cache-Control', 'no-store');
    return clearSession(response);
}
