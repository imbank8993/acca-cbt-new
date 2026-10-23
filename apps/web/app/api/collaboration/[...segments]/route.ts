import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ segments: string[] }> };
const path = async (context: Context) => `/collaboration/${(await context.params).segments.map(encodeURIComponent).join('/')}`;
export async function GET(request: NextRequest, context: Context) { return proxyGet(request, await path(context)); }
export async function PUT(request: NextRequest, context: Context) { return proxyJson(request, await path(context), 'PUT'); }
export async function DELETE(request: NextRequest, context: Context) { return proxyJson(request, await path(context), 'DELETE'); }
