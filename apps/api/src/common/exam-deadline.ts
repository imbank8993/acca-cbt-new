/** Shared by answer acceptance and monitoring. All callers supply database time. */
export function examDeadline(
    attempt: { personal_end_time?: string | null; started_at?: string | null; metadata?: Record<string, unknown> | null },
    exam: { end_time?: string | null; duration_minutes?: number | null },
): Date {
    const recovery = attempt.metadata?.proctor_recovery_until;
    const recoveryMs = typeof recovery === 'string' ? Date.parse(recovery) : NaN;
    const personal = attempt.personal_end_time
        ? Date.parse(attempt.personal_end_time)
        : Number.isFinite(recoveryMs) ? recoveryMs
        : Date.parse(attempt.started_at || '') + (exam.duration_minutes || 60) * 60_000;
    const cap = Number.isFinite(recoveryMs) ? recoveryMs
        : exam.end_time ? Date.parse(exam.end_time) : Infinity;
    return new Date(Math.min(personal, cap));
}
