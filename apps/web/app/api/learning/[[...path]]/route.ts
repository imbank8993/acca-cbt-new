import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: NextRequest, context: Context) {
    const { path = [] } = await context.params;
    if (path.length > 2 || (path[0] && !/^[0-9a-f-]{36}$/i.test(path[0])) || (path[1] && !['file', 'progress'].includes(path[1]))) {
        return NextResponse.json({ success: false, error: 'Alamat tidak ditemukan.' }, { status: 404 });
    }
    const target = `/learning${path.length ? '/' + path.join('/') : ''}`;
    if (path[1] !== 'file') {
        return request.method === 'GET'
            ? proxyGet(request, target + (request.nextUrl.searchParams.get('manage') === '1' ? '?manage=1' : ''))
            : proxyJson(request, target, request.method as 'POST' | 'PUT');
    }
    const token = extractRequestToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Silakan login kembali.' }, { status: 401 });
    try {
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const type = request.headers.get('content-type');
        if (type) headers['Content-Type'] = type;
        const init: RequestInit & { duplex?: string } = { method: request.method, headers, cache: 'no-store', signal: request.signal };
        if (request.method === 'POST') { init.body = request.body; init.duplex = 'half'; }
        const response = await fetch(`${process.env.NEST_API_URL || 'http://127.0.0.1:3009/api'}${target}`, init);
        const output = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        for (const key of ['content-type', 'content-disposition', 'content-length']) {
            const value = response.headers.get(key); if (value) output.set(key, value);
        }
        return new NextResponse(response.body, { status: response.status, headers: output });
    } catch {
        return NextResponse.json({ success: false, error: 'Koneksi ke server terputus. Silakan coba lagi.' }, { status: 503 });
    }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
