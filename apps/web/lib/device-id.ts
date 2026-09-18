/**
 * A stable, per-browser device identifier used to bind an in-progress exam
 * attempt to the device that started it (exam integrity — see the device lock
 * in startExamAttemptAction). It is a random opaque id persisted in
 * localStorage; it is NOT a hardware fingerprint and does not identify the
 * person, only "this browser profile on this machine".
 *
 * Reloading the same browser keeps the id; a different browser, another
 * machine, or a cleared/incognito profile yields a new id (and is therefore
 * treated as a different device).
 */
const DEVICE_ID_KEY = 'acca_device_id';

export function getDeviceId(): string {
    if (typeof window === 'undefined') return '';
    try {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch {
        // localStorage blocked (private mode / disabled) — fall back to a
        // volatile id so the exam still loads; the lock simply won't persist
        // across reloads for this session.
        return '';
    }
}
