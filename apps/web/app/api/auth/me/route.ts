import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

/** Identitas dan peran pemanggil, dibaca ulang dari database oleh NestJS. */
export async function GET(request: NextRequest) {
    return proxyGet(request, '/auth/me');
}
