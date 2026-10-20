import { BadRequestException } from '@nestjs/common';
import { MONITORING_EVENTS } from './exam-monitoring';
import type { DbSession } from '../prisma/prisma-db-adapter';

export const TAB_SWITCH_EVENTS = ['tab_switch', 'window_blur', 'blur'];
export const STUDENT_SECURITY_EVENTS = [
    'SCREEN_SHARE_STOPPED', ...TAB_SWITCH_EVENTS, 'exit_fullscreen', 'restricted_shortcut',
    'copy_paste_attempt', 'right_click_attempt', 'tab_close', 'focus_interruption',
];
// tab_close/focus_interruption are silent recovery signals; counting them would
// terminate students for events that never displayed a violation warning.
export const NON_WARNING_EVENTS = [...MONITORING_EVENTS, 'RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED',
    'FORCE_TERMINATED', 'DEVICE_SWITCH_BLOCKED', 'LATE_ANSWER_SYNC', 'tab_close', 'focus_interruption'];
export const SUBMISSION_SECURITY_EVENT_LIMIT = 100;

export interface SubmissionSecurityEvent {
    id: string;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

/** This manifest contains descriptors only. Images use the separate evidence upload. */
export function validateSubmissionSecurityEvents(value?: SubmissionSecurityEvent[]): SubmissionSecurityEvent[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > SUBMISSION_SECURITY_EVENT_LIMIT) {
        throw new BadRequestException('Maksimal 100 catatan pengawasan per pengiriman.');
    }
    const ids = new Set<string>();
    for (const event of value) {
        if (!event || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id) ||
            !STUDENT_SECURITY_EVENTS.includes(event.eventType) || typeof event.createdAt !== 'string' ||
            event.createdAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.createdAt) ||
            !Number.isFinite(Date.parse(event.createdAt)) ||
            !event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) {
            throw new BadRequestException('Catatan pengawasan tidak valid.');
        }
        let encoded: string;
        try { encoded = JSON.stringify(event.metadata); }
        catch { throw new BadRequestException('Metadata pengawasan tidak valid.'); }
        if (encoded.length > 4096 || /"(?:screenshotBase64|base64|image|imageData|screenshot)"\s*:|data:image\//i.test(encoded)) {
            throw new BadRequestException('Gambar harus dikirim melalui unggahan bukti terpisah.');
        }
        if (ids.has(event.id)) throw new BadRequestException('ID catatan pengawasan berulang.');
        ids.add(event.id);
    }
    return value;
}

export async function securityEventCounters(db: DbSession, attemptId: string) {
    const { data: lastReset, error: resetError } = await db.from('cbt_attempt_security_logs')
        .select('created_at').eq('attempt_id', attemptId)
        .in('event_type', ['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (resetError) throw new BadRequestException('Riwayat pengawasan belum dapat diperiksa.');
    const since = lastReset?.created_at;
    let warningQuery = db.from('cbt_attempt_security_logs').select('*', { count: 'exact', head: true })
        .eq('attempt_id', attemptId).not('event_type', 'in', NON_WARNING_EVENTS);
    let tabQuery = db.from('cbt_attempt_security_logs').select('*', { count: 'exact', head: true })
        .eq('attempt_id', attemptId).in('event_type', TAB_SWITCH_EVENTS);
    if (since) { warningQuery = warningQuery.gt('created_at', since); tabQuery = tabQuery.gt('created_at', since); }
    const warnings = await warningQuery;
    const tabs = await tabQuery;
    if (warnings.error || tabs.error) throw new BadRequestException('Penghitung pengawasan belum dapat diperiksa.');
    return { warning_count: warnings.count || 0, tab_switch_count: tabs.count || 0 };
}

/** Caller holds the attempt row lock, shared with submit, expiry and live events. */
export async function persistSubmissionSecurityEvents(db: DbSession, attemptId: string, actorId: string,
    attempt: { status: string; started_at?: string | null; metadata?: Record<string, unknown> | null },
    events: SubmissionSecurityEvent[], now: Date, deadline: Date): Promise<string[]> {
    if (!events.length) return [];
    const { data: logs, error: readError } = await db.from('cbt_attempt_security_logs')
        .select('event_type, metadata, created_at').eq('attempt_id', attemptId);
    if (readError) throw new BadRequestException('Catatan pengawasan belum dapat diperiksa.');
    const existing = new Map<string, { event_type: string; metadata: Record<string, unknown> }>(
        (logs || []).filter((row: any) => typeof row.metadata?.client_event_id === 'string')
            .map((row: any) => [row.metadata.client_event_id, row]));
    const accepted: string[] = [];
    const rows: Array<Record<string, unknown>> = [];
    const start = Date.parse(attempt.started_at || '');
    // Recovery resets keep started_at, so it alone cannot identify stale events.
    const resetCutoff = (logs || []).reduce((latest: number, row: any) => {
        if (!['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED'].includes(row.event_type)) return latest;
        const resetAt = Date.parse(row.created_at || '');
        return Number.isFinite(resetAt) ? Math.max(latest, resetAt) : latest;
    }, -Infinity);
    const end = Math.min(now.getTime() + 5000, deadline.getTime());
    for (const event of events) {
        const previous = existing.get(event.id);
        if (previous) {
            if (previous.event_type === event.eventType && previous.metadata.source === 'student' &&
                previous.metadata.actor_id === actorId) accepted.push(event.id);
            continue;
        }
        const time = Date.parse(event.createdAt);
        // Never admit new evidence after closure or from an older attempt generation.
        // Device clock skew/stale outbox records must not block valid final answers.
        if (attempt.status !== 'in_progress' || !Number.isFinite(start) || !Number.isFinite(end) ||
            time < start || time <= resetCutoff || time > end || now.getTime() - time > 6 * 60 * 60 * 1000) continue;
        rows.push({ attempt_id: attemptId, event_type: event.eventType, created_at: now.toISOString(),
            metadata: { ...event.metadata, timestamp: event.createdAt, client_event_id: event.id,
                actor_id: actorId, source: 'student' } });
        accepted.push(event.id);
    }
    if (rows.length) {
        const { error } = await db.from('cbt_attempt_security_logs').insert(rows);
        if (error) throw new BadRequestException('Catatan pengawasan belum dapat disimpan.');
        const counts = await securityEventCounters(db, attemptId);
        const { error: updateError } = await db.from('cbt_exam_attempts').update(counts)
            .eq('id', attemptId).eq('status', 'in_progress');
        if (updateError) throw new BadRequestException('Penghitung pengawasan belum dapat diperbarui.');
    }
    return accepted;
}
