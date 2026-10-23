import { BadRequestException } from '@nestjs/common';
import { MONITORING_EVENTS } from './exam-monitoring';
import type { DbSession } from '../prisma/prisma-db-adapter';

export const TAB_SWITCH_EVENTS = ['tab_switch', 'window_blur', 'blur'];
export const STUDENT_SECURITY_EVENTS = [
    'SCREEN_SHARE_STOPPED', ...TAB_SWITCH_EVENTS, 'exit_fullscreen', 'restricted_shortcut',
    'copy_paste_attempt', 'right_click_attempt', 'tab_close', 'focus_interruption',
    // Berbagi layar tidak dipulihkan dalam masa toleransi. Berbeda dari
    // SCREEN_SHARE_STOPPED (catatan saja), ini DIHITUNG sebagai pelanggaran:
    // tanpa itu, menghentikan berbagi layar menjadi jeda bebas tanpa pengawasan.
    'screen_share_lost',
];
// tab_close/focus_interruption are silent recovery signals; counting them would
// terminate students for events that never displayed a violation warning.
const LATE_EVENT = 'LATE_SECURITY_EVIDENCE';
export const NON_WARNING_EVENTS = [...MONITORING_EVENTS, 'RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED',
    'FORCE_TERMINATED', 'DEVICE_SWITCH_BLOCKED', 'LATE_ANSWER_SYNC', 'tab_close', 'focus_interruption'];
export const SUBMISSION_SECURITY_EVENT_LIMIT = 100;
/** Batas bukti susulan per pengerjaan, supaya klien tidak dapat membanjiri log. */
export const LATE_SECURITY_EVIDENCE_LIMIT = 200;

export interface SubmissionSecurityEvent {
    id: string;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

/** Student logs store descriptors only; screenshots have encrypted, expiring storage. */
export function validateStudentSecurityMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new BadRequestException('Metadata pengawasan tidak valid.');
    }
    let encoded: string | undefined;
    try { encoded = JSON.stringify(metadata); }
    catch { throw new BadRequestException('Metadata pengawasan tidak valid.'); }
    if (typeof encoded !== 'string' || encoded.length > 4096 ||
        /"(?:screenshotBase64|base64|image|imageData|screenshot)"\s*:|data:image\//i.test(encoded)) {
        throw new BadRequestException('Gambar harus dikirim melalui unggahan bukti terpisah.');
    }
    return metadata;
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
            !Number.isFinite(Date.parse(event.createdAt))) {
            throw new BadRequestException('Catatan pengawasan tidak valid.');
        }
        validateStudentSecurityMetadata(event.metadata);
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

/**
 * Caller holds the attempt row lock, shared with submit, expiry and live events.
 *
 * Catatan yang terlambat datang TIDAK dibuang diam-diam. Peringatan yang terjadi
 * selama perangkat offline baru sampai setelah attempt ditutup otomatis, atau
 * setelah proktor membuka pemulihan. Dulu keduanya dibuang, sehingga offline
 * sampai waktu habis menghapus seluruh jejak pelanggaran. Sekarang disimpan
 * sebagai LATE_SECURITY_EVIDENCE: terlihat oleh pengawas, tetapi tidak dihitung
 * ulang ke batas pelanggaran generasi yang sedang berjalan.
 */
export async function persistSubmissionSecurityEvents(db: DbSession, attemptId: string, actorId: string,
    attempt: { status: string; started_at?: string | null; finished_at?: string | null; metadata?: Record<string, unknown> | null },
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
    // Attempt yang ditutup sistem/pengawas: bukti sah hanya sampai saat ditutup.
    // Attempt yang dikumpulkan siswa sudah membawa manifest lengkap saat online.
    const finished = Date.parse(attempt.finished_at || '');
    const closedEnd = attempt.status === 'auto_submitted'
        ? Math.min(deadline.getTime(), Number.isFinite(finished) ? finished : deadline.getTime()) + 5000 : NaN;
    let lateCount = (logs || []).filter((row: any) => row.event_type === LATE_EVENT).length;
    let counted = 0;
    for (const event of events) {
        const previous = existing.get(event.id);
        if (previous) {
            const previousType = previous.event_type === LATE_EVENT ? previous.metadata.original_event_type : previous.event_type;
            if (previousType === event.eventType && previous.metadata.source === 'student' &&
                previous.metadata.actor_id === actorId) accepted.push(event.id);
            continue;
        }
        const time = Date.parse(event.createdAt);
        // Device clock skew/stale outbox records must not block valid final answers.
        if (!Number.isFinite(start) || time < start || now.getTime() - time > 6 * 60 * 60 * 1000) continue;
        let late: 'after_close' | 'before_reset' | null = null;
        if (attempt.status === 'in_progress') {
            if (!Number.isFinite(end) || time > end) continue;
            if (time <= resetCutoff) late = 'before_reset';
        } else if (attempt.status === 'auto_submitted') {
            if (!Number.isFinite(closedEnd) || time > closedEnd) continue;
            late = time <= resetCutoff ? 'before_reset' : 'after_close';
        } else continue;
        if (late && lateCount >= LATE_SECURITY_EVIDENCE_LIMIT) continue;
        const base = { ...event.metadata, timestamp: event.createdAt, client_event_id: event.id,
            actor_id: actorId, source: 'student' };
        if (late) {
            lateCount += 1;
            rows.push({ attempt_id: attemptId, event_type: LATE_EVENT, created_at: now.toISOString(),
                metadata: { ...base, original_event_type: event.eventType, late_reason: late } });
        } else {
            counted += 1;
            rows.push({ attempt_id: attemptId, event_type: event.eventType, created_at: now.toISOString(), metadata: base });
        }
        accepted.push(event.id);
    }
    if (rows.length) {
        const { error } = await db.from('cbt_attempt_security_logs').insert(rows);
        if (error) throw new BadRequestException('Catatan pengawasan belum dapat disimpan.');
    }
    if (counted) {
        const counts = await securityEventCounters(db, attemptId);
        const { error: updateError } = await db.from('cbt_exam_attempts').update(counts)
            .eq('id', attemptId).eq('status', 'in_progress');
        if (updateError) throw new BadRequestException('Penghitung pengawasan belum dapat diperbarui.');
    }
    return accepted;
}
