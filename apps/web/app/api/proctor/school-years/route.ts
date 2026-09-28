import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return proxyGet(request, '/proctor/school-years');
}

export async function POST(request: NextRequest) {
    return proxyJson(request, '/proctor/school-years');
}
