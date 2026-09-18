import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    return proxyGet(request, `/exam-configs?organizationId=${encodeURIComponent(organizationId)}`);
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/exam-configs');
}
