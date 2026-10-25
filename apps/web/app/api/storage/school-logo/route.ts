import { extractRequestToken } from '@/lib/app-jwt';
import { NextRequest, NextResponse } from 'next/server';

const NEST_API_URL = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';

/**
 * GET /api/storage/school-logo
 *
 * Logo profil sekolah untuk kop dokumen, disajikan dari origin aplikasi agar
 * dapat disematkan ke PDF dan halaman cetak walaupun berkas aslinya berada di
 * host lain yang tidak mengizinkan CORS.
 */
export async function GET(request: NextRequest) {
    const token = extractRequestToken(request);
    if (!token) return new NextResponse(null, { status: 401 });

    try {
        const res = await fetch(`${NEST_API_URL}/storage/school-logo`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (!res.ok) return new NextResponse(null, { status: res.status });

        const headers = new Headers();
        for (const name of ['content-type', 'content-length', 'cache-control', 'content-security-policy',
            'cross-origin-resource-policy', 'x-content-type-options']) {
            const value = res.headers.get(name);
            if (value) headers.set(name, value);
        }
        headers.set('Vary', 'Cookie, Authorization');
        return new NextResponse(res.body, { status: 200, headers });
    } catch {
        return new NextResponse(null, { status: 502 });
    }
}
