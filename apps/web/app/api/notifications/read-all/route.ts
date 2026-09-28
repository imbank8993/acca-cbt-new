import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return proxy(request, '/notifications/read-all', { method: 'POST' });
}
