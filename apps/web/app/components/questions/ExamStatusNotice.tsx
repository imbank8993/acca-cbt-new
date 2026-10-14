'use client';

export type ExamNotice = { text: string; details: string; tone: 'amber' | 'blue' };

/** Lives in the header flow, so even long notices never cover questions. */
export function ExamStatusNotice({ notice }: { notice?: ExamNotice | null }) {
    if (!notice) return null;
    return <details className={`shrink-0 border-b px-4 py-1.5 text-xs ${notice.tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
        : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200'}`}>
        <summary className="cursor-pointer" aria-live="polite">{notice.text}</summary>
        <p className="mt-1 max-h-24 overflow-y-auto leading-relaxed">{notice.details}</p>
    </details>;
}
