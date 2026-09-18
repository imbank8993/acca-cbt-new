import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function POST(request: NextRequest) {
    return proxyJson(request, '/exam-configs/banks');
}
