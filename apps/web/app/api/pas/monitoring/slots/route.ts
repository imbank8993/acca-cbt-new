import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const search = request.nextUrl.searchParams.toString();
    return proxyGet(request, `/pas/monitoring/slots${search ? `?${search}` : ''}`);
}
