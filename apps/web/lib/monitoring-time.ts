import type { ExamAttemptRecord } from './api/proctor';

/** Use one server-based instant for elapsed time and remaining time. */
export function monitoringTime(attempt: Pick<ExamAttemptRecord,
    'status' | 'started_at' | 'finished_at' | 'server_now' | 'deadline_at' | 'remaining_seconds'>,
    elapsedSinceSample: number,
) {
    const parse = (value?: string | null) => value ? Date.parse(value) : NaN;
    const started = parse(attempt.started_at);
    const deadline = parse(attempt.deadline_at);
    const sample = parse(attempt.server_now);
    const elapsed = Number.isFinite(elapsedSinceSample) ? Math.max(0, elapsedSinceSample) : 0;
    const now = sample + elapsed * 1000;
    const finished = parse(attempt.finished_at);
    const end = Number.isFinite(finished) ? finished : now;
    const cappedEnd = Number.isFinite(deadline) ? Math.min(end, deadline) : end;
    const remainingSeconds = Number.isFinite(deadline) && Number.isFinite(now)
        ? Math.max(0, Math.ceil((deadline - now) / 1000))
        : typeof attempt.remaining_seconds === 'number' && Number.isFinite(attempt.remaining_seconds)
            ? Math.max(0, Math.ceil(attempt.remaining_seconds - elapsed)) : null;
    return {
        remainingSeconds: attempt.status === 'in_progress' ? remainingSeconds : null,
        workedSeconds: Number.isFinite(started) && Number.isFinite(cappedEnd)
            ? Math.max(0, Math.floor((cappedEnd - started) / 1000)) : null,
        availableSeconds: Number.isFinite(started) && Number.isFinite(deadline)
            ? Math.max(0, Math.ceil((deadline - started) / 1000)) : null,
    };
}

export function formatMonitoringDuration(seconds: number | null): string {
    if (seconds === null) return '—';
    const hours = Math.floor(seconds / 3600);
    return `${hours ? `${hours}j ` : ''}${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}dtk`;
}
