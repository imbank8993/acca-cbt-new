/**
 * Remove duplicate join rows by ID, never by text or answer value, then sort
 * by the stored `order` so option letters (A, B, C, …) match what students see.
 */
export function dedupeOptions(options: any[]): any[] {
    const seen = new Set<string>();

    return options
        .filter((option) => {
            if (!option.id) return true;
            const key = option.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}
