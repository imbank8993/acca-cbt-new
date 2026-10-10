import { createHash } from 'node:crypto';
import { hasActiveSubmitIntent } from './exam-deadline';

export interface SubmissionPayload {
    answers: Record<string, string>;
    answerRevisions?: Record<string, number>;
    assignmentData?: Record<string, unknown>;
    frozenSubmission?: { startedAt: string; personalEndTime: string };
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value)
        .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
    return JSON.stringify(value) ?? 'null';
}

/** The server computes this from the actual pre-deadline payload, never a client timestamp. */
export function submissionDigest(payload: SubmissionPayload): string {
    return createHash('sha256').update(canonical({ answers: payload.answers,
        answerRevisions: payload.answerRevisions || {}, assignmentData: payload.assignmentData ?? null,
        frozenSubmission: payload.frozenSubmission ?? null })).digest('hex');
}

export function hasBoundSubmitIntent(metadata: Record<string, unknown> | null | undefined,
    now: Date, deadline: Date, digest?: string): boolean {
    return Boolean(digest) && metadata?.submit_intent_digest === digest &&
        hasActiveSubmitIntent(metadata, now) && Date.parse(String(metadata?.submit_intent_at)) < deadline.getTime();
}
