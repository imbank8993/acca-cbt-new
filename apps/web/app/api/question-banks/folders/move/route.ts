import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PUT(request: NextRequest) {
    return proxyJson(request, '/question-banks/folders/move', 'PUT');
}
