/**
 * Bahan ajar "Video YouTube": guru menempel tautan, server menyimpan tautan
 * baku `https://www.youtube.com/watch?v=<ID>` (11 karakter), dan halaman baca
 * memutarnya lewat youtube-nocookie.com. Hanya host YouTube resmi yang diterima.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be']);

/** ID video dari tautan YouTube yang umum dipakai; `null` bila bukan tautan video YouTube. */
export function youtubeVideoId(input: string): string | null {
    const text = (input || '').trim();
    if (!text || text.length > 2000) return null;
    if (VIDEO_ID.test(text)) return text;
    let url: URL;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (!HOSTS.has(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null | undefined;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] || '')) id = parts[1];
    return id && VIDEO_ID.test(id) ? id : null;
}

/** Detik mulai dari `t=90`, `t=1m30s`, atau `start=90`; 0 bila tidak ada. */
export function youtubeStartSeconds(input: string): number {
    let url: URL;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); } catch { return 0; }
    const raw = url.searchParams.get('t') || url.searchParams.get('start') || '';
    if (/^\d+s?$/.test(raw)) return Math.min(Number.parseInt(raw, 10), 86_400);
    const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match || !raw) return 0;
    return Math.min(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0), 86_400);
}

/** Tautan baku yang disimpan; `null` bila masukan bukan tautan video YouTube. */
export function canonicalYoutubeUrl(input: string): string | null {
    const id = youtubeVideoId(input);
    if (!id) return null;
    const start = youtubeStartSeconds(input);
    return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}`;
}

/** Alamat pemutar mode privasi untuk tautan baku yang tersimpan. */
export function youtubeEmbedUrl(input: string): string | null {
    const id = youtubeVideoId(input);
    if (!id) return null;
    const start = youtubeStartSeconds(input);
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${start ? `&start=${start}` : ''}`;
}
