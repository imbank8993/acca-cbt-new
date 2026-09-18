import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PUT(request: NextRequest) {
    return proxyJson(request, '/question-banks/folders/move', 'PUT');
}
