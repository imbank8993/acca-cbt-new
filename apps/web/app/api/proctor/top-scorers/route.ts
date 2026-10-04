import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const query = new URLSearchParams();
    const limit = request.nextUrl.searchParams.get('limit');
    if (limit) query.set('limit', limit);
    return proxyGet(request, `/proctor/top-scorers?${query.toString()}`);
}
