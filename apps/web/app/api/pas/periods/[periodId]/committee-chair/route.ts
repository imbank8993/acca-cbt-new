import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ periodId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    const body = await request.text();
    return proxy(request, `/pas/periods/${encodeURIComponent(periodId)}/committee-chair`, {
        method: 'PATCH',
        body: body || undefined,
    });
}
