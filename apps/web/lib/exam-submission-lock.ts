/** Share in-flight deliveries in this tab and serialize them across tabs where supported. */
const deliveries = new Map<string, Promise<unknown>>();
export function withExamSubmissionLock<T>(key: string, send: () => Promise<T>): Promise<T> {
    const pending = deliveries.get(key);
    if (pending) return pending as Promise<T>;
    const request = Promise.resolve().then(async (): Promise<T> => {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return await navigator.locks.request('exam-submit:' + key, send);
        }
        return send();
    }).finally(() => {
        if (deliveries.get(key) === request) deliveries.delete(key);
    });
    deliveries.set(key, request);
    return request;
}
