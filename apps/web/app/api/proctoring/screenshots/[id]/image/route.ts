import { extractRequestToken } from '@/lib/app-jwt';
import { NextRequest, NextResponse } from 'next/server';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const token = extractRequestToken(request);
    if (!token) return new NextResponse(null, { status: 401 });
    const { id } = await context.params;
    const base = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';
    try {
        const response = await fetch(`${base}/proctoring/screenshots/${encodeURIComponent(id)}/image`,
            { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok) return new NextResponse(null, { status: response.status });
        return new NextResponse(response.body, { headers: {
            'Content-Type': response.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff',
        } });
    } catch { return new NextResponse(null, { status: 502 }); }
}
