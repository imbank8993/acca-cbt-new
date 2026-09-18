import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const query = new URLSearchParams({ organizationId: params.get('organizationId') || '' });
    const limit = params.get('limit');
    if (limit) query.set('limit', limit);
    return proxyGet(request, `/proctor/recent-logins?${query.toString()}`);
}
