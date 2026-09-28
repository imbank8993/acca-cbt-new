import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return proxyJson(request, '/exam-configs/generate');
}
