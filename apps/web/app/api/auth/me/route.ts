import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

/** Identitas dan peran pemanggil, dibaca ulang dari database oleh NestJS. */
export async function GET(request: NextRequest) {
    return proxyGet(request, '/auth/me');
}
