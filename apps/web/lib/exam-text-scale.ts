/** Question text sizes a student can pick during an exam (1 = 100%). */
export const EXAM_TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5] as const;
export const EXAM_TEXT_SCALE_KEY = 'cbt-exam-text-scale';

/** Snap any stored or requested value to the nearest allowed size. */
export function normalizeExamTextScale(value: unknown): number {
    const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return 1;
    return EXAM_TEXT_SCALES.reduce<number>((best, scale) => (
        Math.abs(scale - numeric) < Math.abs(best - numeric) ? scale : best
    ), 1);
}

export function stepExamTextScale(current: number, direction: 1 | -1): number {
    const index = EXAM_TEXT_SCALES.indexOf(normalizeExamTextScale(current) as typeof EXAM_TEXT_SCALES[number]);
    const next = Math.min(EXAM_TEXT_SCALES.length - 1, Math.max(0, index + direction));
    return EXAM_TEXT_SCALES[next];
}

export function readStoredExamTextScale(): number {
    try {
        return normalizeExamTextScale(window.localStorage.getItem(EXAM_TEXT_SCALE_KEY));
    } catch {
        return 1;
    }
}

export function storeExamTextScale(scale: number): void {
    try {
        if (scale === 1) window.localStorage.removeItem(EXAM_TEXT_SCALE_KEY);
        else window.localStorage.setItem(EXAM_TEXT_SCALE_KEY, String(scale));
    } catch {
        // Private mode or blocked storage: the size still applies for this page.
    }
}

/**
 * CSS zoom reflows the question like browser zoom, so long text wraps
 * instead of overflowing. Browsers without it simply hide the control.
 */
export function supportsExamTextScale(): boolean {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.5');
}
