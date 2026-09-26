import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const query = new URLSearchParams();
    if (params.get('activeYearOnly') === 'true') query.set('activeYearOnly', 'true');
    return proxyGet(request, `/pas/classes?${query.toString()}`);
}
