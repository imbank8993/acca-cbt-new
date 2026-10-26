import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ periodId: string }> };

export async function POST(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    return proxy(request, `/pas/periods/${encodeURIComponent(periodId)}/merge-exams`, { method: 'POST', body: '{}' });
}
