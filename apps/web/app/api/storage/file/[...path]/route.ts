import { extractRequestToken } from '@/lib/app-jwt';
import { NextRequest, NextResponse } from 'next/server';

const NEST_API_URL = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';

/**
 * GET /api/storage/file/[...path]
 *
 * Proxy untuk menyajikan berkas Cloudflare R2 yang dialirkan dari NestJS.
 * Menghilangkan dependensi terhadap DNS *.r2.dev yang kerap diblokir oleh
 * ISP di Indonesia (TrustPositif/Kominfo/Nawala).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const key = (path || []).join('/');

  if (!key) {
    return NextResponse.json({ error: 'Object key tidak ditentukan.' }, { status: 400 });
  }

  const backendUrl = `${NEST_API_URL}/storage/file/${key.split('/').map(encodeURIComponent).join('/')}`;

  try {
    const res = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        ...(extractRequestToken(request) ? { Authorization: `Bearer ${extractRequestToken(request)}` } : {}),
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const headers = new Headers();
    const contentType = res.headers.get('content-type');
    const contentLength = res.headers.get('content-length');
    const cacheControl = res.headers.get('cache-control') || 'private, no-store';
    const etag = res.headers.get('etag');

    if (contentType) headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    headers.set('Cache-Control', cacheControl);
    headers.set('Vary', 'Cookie, Authorization');
    headers.set('X-Content-Type-Options', 'nosniff');
    // Header pengaman dari NestJS wajib ikut: berkas disajikan dari origin
    // aplikasi, dan tanpa sandbox SVG yang dibuka di tab dapat menjalankan skrip.
    for (const name of ['content-security-policy', 'content-disposition', 'cross-origin-resource-policy']) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('content-security-policy') && !/^application\/pdf\b/i.test(contentType || '')) {
      headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
    }
    if (etag) headers.set('ETag', etag);

    return new NextResponse(res.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Gagal memuat berkas dari penyimpanan.' },
      { status: 502 },
    );
  }
}
