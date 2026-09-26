import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/proctor/stats');
}
