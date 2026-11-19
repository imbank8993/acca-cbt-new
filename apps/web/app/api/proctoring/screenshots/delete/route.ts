import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
/** Hapus beberapa gambar bukti sekaligus (Proktor/Admin); izin diperiksa per gambar di server. */
export async function POST(request: NextRequest) {
    return proxyJson(request, '/proctoring/screenshots/delete');
}
