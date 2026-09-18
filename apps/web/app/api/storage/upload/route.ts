/**
 * POST   /api/storage/upload — proxy ke NestJS /storage/upload
 * DELETE /api/storage/upload — proxy ke NestJS /storage/upload
 *
 * Logika upload, validasi ekstensi, sanitasi folder, dan otorisasi
 * kepemilikan file kini sepenuhnya ada di NestJS (StorageController).
 * Route ini hanya meneruskan request multipart/form-data dengan cookie sesi.
 *
 * Mengapa tidak memakai proxy() biasa dari nest-proxy.ts?
 * Karena proxy() membaca body sebagai teks/JSON. Multipart harus diteruskan
 * sebagai stream binary — itulah yang dilakukan fetch() di bawah ini.
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';

const NEST_API_URL = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';

async function forwardToNest(request: NextRequest, method: 'POST' | 'DELETE') {
  const token = extractRequestToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
      { status: 401 },
    );
  }

  // Teruskan apa adanya ke NestJS — termasuk multipart boundary.
  // TIDAK di-buffer di sini: streaming body langsung agar memori tidak
  // berlipat ganda per file.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  // Untuk POST multipart, Content-Type harus ikut (dengan boundary) supaya
  // NestJS tahu cara membaca file-nya.
  const ct = request.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;

  const res = await fetch(`${NEST_API_URL}/storage/upload`, {
    method,
    headers,
    body: method === 'DELETE' ? await request.text() : (request.body as BodyInit),
    // @ts-expect-error — Node fetch perlu duplex untuk streaming body
    duplex: 'half',
  });

  const body = await res.text();
  let json: unknown;
  try { json = JSON.parse(body); } catch { json = { error: body }; }

  return NextResponse.json(json, { status: res.status });
}

export async function POST(request: NextRequest) {
  return forwardToNest(request, 'POST');
}

export async function DELETE(request: NextRequest) {
  return forwardToNest(request, 'DELETE');
}
