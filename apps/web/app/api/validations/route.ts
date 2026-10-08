import { proxyGet, proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const bankId = url.searchParams.get('bankId');
    const path = bankId ? `/validations?bankId=${encodeURIComponent(bankId)}` : '/validations';
    return proxyGet(request, path);
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/validations', 'POST');
}
