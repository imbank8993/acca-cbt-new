/** Only application dashboard destinations are valid notification actions. */
export function safeNotificationUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.startsWith('/dashboard/') || /[\\\x00-\x20]/.test(value)) return null;
    try {
        const url = new URL(value, 'https://notification.invalid');
        if (url.origin !== 'https://notification.invalid' || !url.pathname.startsWith('/dashboard/')) return null;
        return url.pathname + url.search + url.hash;
    } catch { return null; }
}
export function mergeNotifications<T extends { id: string }>(current: T[], incoming: T[]): T[] {
    return Array.from(new Map([...current, ...incoming].map(item => [item.id, item])).values());
}
