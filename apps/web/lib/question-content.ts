/** Rich question content can consist entirely of an image or embedded media. */
export function hasQuestionContent(html?: string | null): boolean {
    if (!html) return false;
    const content = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    if (/<(?:img|audio|video|iframe|source)\b[^>]*\bsrc\s*=\s*(?:"[^"\s][^"]*"|'[^'\s][^']*'|[^\s>"']+)/i.test(content)) return true;
    if (/<(?:svg|math)\b[^>]*>[\s\S]*?<\/(?:svg|math)>/i.test(content)) return true;
    return content.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ')
        .replace(/[\s\u00a0\u200b\uFEFF]/g, '').length > 0;
}
