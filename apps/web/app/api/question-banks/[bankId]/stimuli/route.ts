import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ bankId: string }> };

export async function GET(request: NextRequest, context: Context) {
    const { bankId } = await context.params;
    return proxyGet(request, `/question-banks/${encodeURIComponent(bankId)}/stimuli`);
}

export async function POST(request: NextRequest, context: Context) {
    const { bankId } = await context.params;
    return proxyJson(request, `/question-banks/${encodeURIComponent(bankId)}/stimuli`);
}
