import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const query = new URLSearchParams();
    const limit = params.get('limit');
    if (limit) query.set('limit', limit);
    return proxyGet(request, `/proctor/login-history?${query.toString()}`);
}
