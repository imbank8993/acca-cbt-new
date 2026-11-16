import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

/** Tetapkan kelayakan banyak butir sekaligus (mis. "Tandai semua Layak"). */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return proxyJson(request, `/validations/${encodeURIComponent(id)}/items`, 'PUT');
}
