/** Empty placeholders are not answers; numeric zero and boolean false are valid answers. */
export function hasAnswerValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text || text === 'undefined') return false;
        try {
            const decoded: unknown = JSON.parse(text);
            // A JSON-encoded string should not be parsed recursively forever.
            return typeof decoded === 'string' ? decoded.trim().length > 0 : hasAnswerValue(decoded);
        } catch { return true; }
    }
    if (Array.isArray(value)) return value.some(hasAnswerValue);
    if (typeof value === 'object') return Object.values(value).some(hasAnswerValue);
    return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
}

export function hasStoredAnswer(answer: { essay_answer?: unknown; selected_option_id?: unknown }): boolean {
    return hasAnswerValue(answer.essay_answer) || hasAnswerValue(answer.selected_option_id);
}
