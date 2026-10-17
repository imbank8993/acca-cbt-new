import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PUT(request: NextRequest, context: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await context.params;
    return proxyJson(request, `/pas/schedules/${encodeURIComponent(scheduleId)}/activation`, 'PUT');
}
