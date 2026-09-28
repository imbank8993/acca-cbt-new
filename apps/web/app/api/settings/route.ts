import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/settings');
}

export async function PUT(request: NextRequest) {
    return proxyJson(request, '/settings', 'PUT');
}
