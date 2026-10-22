'use client';
import { AlertTriangle, ChevronDown, Info, X } from 'lucide-react';
import { useState } from 'react';

export type ExamNotice = { text: string; details: string; tone: 'amber' | 'blue' };

/**
 * Floating, dismissible status alert. It overlays the page instead of
 * reserving a row above the header, so the header stays in place.
 * Dismissal applies to the current message text only: a new or changed
 * message (e.g. "3 soal diperbarui" after "2 soal diperbarui") shows again,
 * and so does a status that clears and later comes back.
 */
export function ExamStatusNotice({ notice }: { notice?: ExamNotice | null }) {
    const [dismissedText, setDismissedText] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [lastText, setLastText] = useState<string | null>(null);

    const text = notice?.text ?? null;
    if (text !== lastText) {
        setLastText(text);
        setExpanded(false);
        if (text === null) setDismissedText(null);
    }

    if (!notice || dismissedText === notice.text) return null;
    const amber = notice.tone === 'amber';
    const Icon = amber ? AlertTriangle : Info;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`fixed left-1/2 top-3 z-[10003] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-lg ${amber
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
                : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200'}`}
        >
            <div className="flex items-start gap-2">
                <Icon size={16} className="mt-0.5 shrink-0" />
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold"
                >
                    <span className="truncate">{notice.text}</span>
                    <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                <button
                    type="button"
                    onClick={() => setDismissedText(notice.text)}
                    aria-label="Tutup pemberitahuan"
                    className="-m-1 shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                    <X size={14} />
                </button>
            </div>
            {expanded && <p className="mt-1.5 max-h-32 overflow-y-auto pl-6 leading-relaxed">{notice.details}</p>}
        </div>
    );
}
