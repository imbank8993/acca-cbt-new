import { apiSend } from './api/client';
import { logSecurityViolation } from './api/proctoring';
import { getDeviceId } from './device-id';
import { readSecurityEvents, removeSecurityEvent } from './exam-durable-storage';
import { sendScreenshotWithRetry } from './exam-screenshots';

const inFlight = new Map<string, Promise<void>>();

/** Finish pending evidence after submission without changing the completed exam. */
export function retryExamEvidence(attemptId: string): Promise<void> {
    const current = inFlight.get(attemptId);
    if (current) return current;
    if (!attemptId || typeof navigator === 'undefined' || navigator.onLine === false) return Promise.resolve();

    const retry = (async () => {
        try {
            const events = await readSecurityEvents(attemptId);
            for (const event of events) {
                // Capture can still be encoding when submission finishes. Its
                // descriptor must survive until the image has been attached.
                if (!event.screenshotBase64) continue;
                if (navigator.onLine === false) break;
                const logged = await logSecurityViolation(attemptId, event.eventType, event.metadata, event.id);
                if (!logged.success) break;

                const payload = { clientEventId: event.id, deviceId: getDeviceId(), imageBase64: event.screenshotBase64 };
                const uploaded = await sendScreenshotWithRetry(() => apiSend<{ saved: boolean; reason?: string }>(
                    `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`,
                    payload, 'POST', { timeoutMs: 20_000 },
                ));
                const acknowledged = uploaded.success
                    ? uploaded.saved || uploaded.reason === 'limit' || uploaded.reason === 'cooldown'
                    : uploaded.retryable === false;
                if (!acknowledged) break;
                await removeSecurityEvent(attemptId, event.id, event);
            }
        } catch {
            // Network/storage interruptions leave the durable entry for the
            // next online or results-page retry, reusing the same event ID.
        }
    })().finally(() => { inFlight.delete(attemptId); });
    inFlight.set(attemptId, retry);
    return retry;
}
