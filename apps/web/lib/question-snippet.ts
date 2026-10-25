/**
 * Menghasilkan cuplikan teks pendek (1 baris) dari konten soal yang mungkin memuat
 * tag HTML/stimulus panjang. Mencegah kartu soal mobile menjadi terlalu tinggi.
 */
export function getQuestionSnippet(html?: string | null, maxLen = 70): string {
    if (!html) return 'Soal';
    const text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\\[dt]?frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) return 'Soal';
    if (text.length <= maxLen) return text;

    let truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.7) {
        truncated = truncated.slice(0, lastSpace);
    }
    const dollarMatches = truncated.match(/\$/g);
    if (dollarMatches && dollarMatches.length % 2 !== 0) {
        truncated += '$';
    }
    return truncated + '…';
}
