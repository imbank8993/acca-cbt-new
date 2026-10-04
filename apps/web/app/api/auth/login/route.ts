import { encodeSessionCookie,SESSION_COOKIE,sessionCookieOptions } from '@/lib/app-jwt';
import { nestFetchInternal } from '@/lib/nest-api';
import { NextRequest,NextResponse } from 'next/server';

const TWELVE_HOURS = 12 * 60 * 60;

/**
 * Masuk dengan email dan password.
 *
 * Token TIDAK dikembalikan ke browser dalam body. Ia disimpan di cookie
 * httpOnly, jadi JavaScript halaman tidak pernah bisa membacanya — penting untuk
 * aplikasi ujian yang merender HTML soal dari editor dan memuat berkas unggahan
 * pengguna.
 */
export async function POST(request: NextRequest) {
    const { email, password } = await request.json().catch(() => ({}));

    const forwarded = request.headers.get('x-forwarded-for');
    const ipAddress = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;
    const userAgent = request.headers.get('user-agent') || undefined;

    if (!email || !password) {
        return NextResponse.json(
            { success: false, error: 'Email dan password wajib diisi.' },
            { status: 400 },
        );
    }

    const { status, body } = await nestFetchInternal<{
        access_token?: string;
        user?: unknown;
        error?: string;
        message?: string;
    }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, ipAddress, userAgent }),
    });

    if (status !== 200 || !body?.access_token) {
        return NextResponse.json(
            { success: false, error: body?.error || body?.message || 'Email atau password salah.' },
            { status: status === 200 ? 401 : status },
        );
    }

    const response = NextResponse.json({ success: true, user: body.user });
    response.cookies.set(
        SESSION_COOKIE,
        encodeSessionCookie(body.access_token),
        sessionCookieOptions(TWELVE_HOURS),
    );
    return response;
}
