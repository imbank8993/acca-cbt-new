import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/question-banks/folders');
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/question-banks/folders');
}
