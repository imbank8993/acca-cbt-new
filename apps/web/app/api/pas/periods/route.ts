import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/pas/periods');
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/pas/periods');
}
