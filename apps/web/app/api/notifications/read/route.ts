import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(request: NextRequest) {
    return proxy(request, '/notifications/read', { method: 'DELETE' });
}
