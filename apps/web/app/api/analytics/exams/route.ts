import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams.toString();
    return proxyGet(request, `/analytics/exams${q ? `?${q}` : ''}`);
}
