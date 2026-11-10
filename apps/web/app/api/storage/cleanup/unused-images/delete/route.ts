import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

/** POST /api/storage/cleanup/unused-images/delete — hapus gambar yatim hasil pratinjau (Admin). */
export async function POST(request: NextRequest) {
    return proxyJson(request, '/storage/cleanup/unused-images/delete', 'POST');
}
