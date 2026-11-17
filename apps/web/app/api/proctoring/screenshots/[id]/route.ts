import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
type Context = { params: Promise<{ id: string }> };
/** Hapus gambar bukti (Proktor/Admin); izin diperiksa ulang di server. */
export async function DELETE(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxy(request, `/proctoring/screenshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
