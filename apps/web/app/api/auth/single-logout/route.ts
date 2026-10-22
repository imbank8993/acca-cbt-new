import { SECURE_SESSION_COOKIE, SESSION_COOKIE, sessionCookieOptions } from '@/lib/app-jwt';
import { NextRequest, NextResponse } from 'next/server';

function allowedOrigin(request: NextRequest): string | null {
    const origin = request.headers.get('origin');
    const expected = new URL(process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id').origin;
    return origin === expected ? origin : null;
}
function headers(origin: string) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', 'Vary': 'Origin' };
}
export async function POST(request: NextRequest) {
    const origin = allowedOrigin(request);
    if (!origin) return NextResponse.json({ ok: false }, { status: 403 });
    const response = NextResponse.json({ ok: true }, { headers: headers(origin) });
    response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
    response.cookies.set(SECURE_SESSION_COOKIE, '', { ...sessionCookieOptions(0), secure: true });
    return response;
}
export async function OPTIONS(request: NextRequest) {
    const origin = allowedOrigin(request);
    return origin ? new NextResponse(null, { status: 204, headers: headers(origin) }) : NextResponse.json({ ok: false }, { status: 403 });
}
