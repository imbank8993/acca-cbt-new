import { encodeSessionCookie, extractRequestToken, sessionCookieName, sessionCookieOptions } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { NextRequest, NextResponse } from 'next/server';

const TWELVE_HOURS = 12 * 60 * 60;

/**
 * Perpanjang sesi selama ujian berlangsung (NestJS menolak bila tidak ada
 * pengerjaan aktif). Token baru tetap hanya disimpan di cookie httpOnly.
 */
export async function POST(request: NextRequest) {
    const token = extractRequestToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Sesi login berakhir.' }, { status: 401 });
    const { status, body } = await nestFetchAsUser<{ access_token?: string; error?: string; message?: string }>(
        '/auth/refresh', token, { method: 'POST' });
    if (status !== 200 || !body?.access_token) {
        return NextResponse.json(
            { success: false, error: body?.error || body?.message || 'Sesi belum dapat diperpanjang.' },
            { status: status === 200 ? 401 : status },
        );
    }
    const response = NextResponse.json({ success: true });
    response.cookies.set(sessionCookieName(), encodeSessionCookie(body.access_token), sessionCookieOptions(TWELVE_HOURS));
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
