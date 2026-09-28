import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const query = new URLSearchParams();
    if (params.get('onlyPublished') === 'true') query.set('onlyPublished', 'true');
    return proxyGet(request, `/question-banks?${query.toString()}`);
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/question-banks');
}
