import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    return proxyGet(request, `/pas/subjects?organizationId=${encodeURIComponent(organizationId)}`);
}
