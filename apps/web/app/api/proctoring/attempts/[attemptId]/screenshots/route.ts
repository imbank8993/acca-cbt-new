import { proxyGet, proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
type Context = { params: Promise<{ attemptId: string }> };
export async function GET(request: NextRequest, context: Context) {
    const { attemptId } = await context.params;
    return proxyGet(request, `/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`);
}
export async function POST(request: NextRequest, context: Context) {
    const { attemptId } = await context.params;
    return proxyJson(request, `/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`);
}
