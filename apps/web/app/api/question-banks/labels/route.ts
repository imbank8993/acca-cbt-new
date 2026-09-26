import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/question-banks/labels');
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/question-banks/labels');
}
