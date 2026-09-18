import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function POST(request: NextRequest) {
    return proxy(request, '/notifications/read-all', { method: 'POST' });
}
