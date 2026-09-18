export function ensureAbsoluteUrl(url: string): string {
    if (!url) return url;
    if (/^(https?:)?\/\//i.test(url)) return url;
    if (typeof window !== 'undefined' && url.startsWith('/')) {
        return `${window.location.origin}${url}`;
    }
    if (typeof window !== 'undefined') {
        return new URL(url, window.location.origin).toString();
    }
    return url;
}
