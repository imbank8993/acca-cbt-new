import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ periodId: string }> };

export async function GET(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    return proxyGet(request, `/pas/periods/${encodeURIComponent(periodId)}/rooms`);
}

export async function POST(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    return proxyJson(request, `/pas/periods/${encodeURIComponent(periodId)}/rooms`);
}
