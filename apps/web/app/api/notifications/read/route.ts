import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(request: NextRequest) {
    return proxy(request, '/notifications/read', { method: 'DELETE' });
}
