import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams.toString();
    return proxyGet(request, `/notifications${q ? `?${q}` : ''}`);
}
