type ScreenLock = {
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
};
type ScreenLockNavigator = {
    wakeLock?: { request(type: 'screen'): Promise<ScreenLock> };
};

/** Prevent idle screen sleep; browsers may still release the lock themselves. */
export function keepExamScreenAwake(
    nav: ScreenLockNavigator = navigator,
    doc: Document = document,
): () => void {
    let stopped = false;
    let pending = false;
    let lock: ScreenLock | null = null;
    const acquire = async () => {
        if (stopped || pending || lock || doc.visibilityState !== 'visible' || !nav.wakeLock) return;
        pending = true;
        try {
            const next = await nav.wakeLock.request('screen');
            if (stopped || doc.visibilityState !== 'visible') {
                await next.release();
                return;
            }
            lock = next;
            next.addEventListener('release', () => {
                if (lock === next) lock = null;
            });
        } catch {
            // Unsupported policy, low battery or permission denial must not block an exam.
        } finally {
            pending = false;
        }
    };
    const resume = () => { void acquire(); };
    doc.addEventListener('visibilitychange', resume);
    doc.addEventListener('pointerdown', resume);
    void acquire();
    return () => {
        stopped = true;
        doc.removeEventListener('visibilitychange', resume);
        doc.removeEventListener('pointerdown', resume);
        const previous = lock;
        lock = null;
        if (previous) void previous.release().catch(() => {});
    };
}
