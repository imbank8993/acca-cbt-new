import { proxyGet, proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const search = request.nextUrl.searchParams.toString();
    return proxyGet(request, `/pas/administration/slot${search ? `?${search}` : ''}`);
}

export async function PUT(request: NextRequest) {
    return proxyJson(request, '/pas/administration/slot', 'PUT');
}
