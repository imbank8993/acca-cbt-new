import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const query = new URLSearchParams();
    if (params.get('activeYearOnly') === 'true') query.set('activeYearOnly', 'true');
    return proxyGet(request, `/proctor/classes?${query.toString()}`);
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/proctor/classes');
}
