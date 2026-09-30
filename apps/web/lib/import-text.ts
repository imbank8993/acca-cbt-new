export function normalizeImportedOptionText(text: string): string {
    return String(text || '')
        .replace(/<\/p\s*>\s*<p\b[^>]*>/gi, '\n')
        .replace(/<\/?p\b[^>]*>/gi, '')
        .trim();
}
