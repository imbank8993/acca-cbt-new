const SW_PATH = '/exam-sw.js';
const EXAM_CACHE_PREFIX = 'acca-exam-shell-';

function pwaEnabled(): boolean {
    return typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_EXAM_PWA === 'true');
}

export function isExamPwaEnabled(): boolean {
    return pwaEnabled();
}

function examPath(examId: string): string {
    return `/dashboard/siswa/exam/${encodeURIComponent(examId)}`;
}

async function postToWorker(
    message: Record<string, unknown>,
    timeoutMs = 5_000,
): Promise<boolean> {
    if (!pwaEnabled()) return false;
    try {
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active || registration.waiting || registration.installing;
        if (!worker) return false;
        return await new Promise<boolean>(resolve => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => resolve(false), timeoutMs);
            channel.port1.onmessage = event => {
                window.clearTimeout(timeout);
                resolve(event.data?.success === true);
            };
            worker.postMessage(message, [channel.port2]);
        });
    } catch {
        return false;
    }
}

export async function registerExamServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!pwaEnabled()) return null;
    try {
        return await navigator.serviceWorker.register(SW_PATH, { scope: '/', updateViaCache: 'none' });
    } catch {
        return null;
    }
}

/** Simpan shell route ujian dan seluruh chunk Next yang sudah dipakai halaman. */
export async function cacheExamOfflineShell(examId: string): Promise<boolean> {
    const assets = typeof performance === 'undefined'
        ? []
        : performance.getEntriesByType('resource')
            .map(entry => entry.name)
            .filter(value => {
                try {
                    const url = new URL(value, window.location.origin);
                    return url.origin === window.location.origin && url.pathname.startsWith('/_next/');
                } catch {
                    return false;
                }
            });
    return postToWorker({ type: 'CACHE_EXAM_SHELL', path: examPath(examId), assets }, 30_000);
}

export async function removeExamOfflineShell(examId: string): Promise<void> {
    await postToWorker({ type: 'UNCACHE_EXAM_SHELL', path: examPath(examId) });
}

export async function clearExamOfflineShells(): Promise<void> {
    await postToWorker({ type: 'CLEAR_EXAM_CACHES' });
    // Jalur langsung juga membersihkan cache bila worker baru saja diperbarui
    // atau belum menjadi controller saat pengguna menekan logout.
    if (typeof caches === 'undefined') return;
    try {
        const names = await caches.keys();
        await Promise.all(names
            .filter(name => name.startsWith(EXAM_CACHE_PREFIX))
            .map(name => caches.delete(name)));
    } catch {
        // Logout server tetap dilanjutkan walaupun browser menolak Cache API.
    }
}
