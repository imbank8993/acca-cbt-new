import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/app-jwt';

export async function POST() {
    const response = NextResponse.json({ success: true });
    // maxAge 0 menghapus cookie. Opsi lainnya harus sama persis dengan saat
    // cookie diterbitkan, jika tidak browser membuat cookie kedua alih-alih
    // menimpa yang lama.
    response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
    return response;
}
