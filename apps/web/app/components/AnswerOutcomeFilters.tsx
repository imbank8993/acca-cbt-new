'use client';

import type { AnswerOutcomeFilter, AnswerOutcomeSummary } from '@/lib/answer-stats';

export function AnswerOutcomeFilters({ value, onChange, stats }: {
    value: AnswerOutcomeFilter;
    onChange: (value: AnswerOutcomeFilter) => void;
    stats: AnswerOutcomeSummary;
}) {
    const options = [
        { value: 'all', label: 'Semua', count: stats.total, active: 'bg-[#3083FF] border-[#3083FF] text-white' },
        { value: 'correct', label: 'Benar', count: stats.correct, active: 'bg-emerald-600 border-emerald-600 text-white' },
        { value: 'wrong', label: 'Salah', count: stats.wrong, active: 'bg-red-500 border-red-500 text-white' },
        { value: 'unanswered', label: 'Tidak dijawab', count: stats.unanswered, active: 'bg-slate-600 border-slate-600 text-white' },
    ] as const;

    return (
        <div role="group" aria-label="Filter status jawaban" className="flex flex-wrap gap-2">
            {options.map(option => (
                <button key={option.value} type="button" aria-pressed={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3083FF] focus-visible:ring-offset-2 ${value === option.value ? option.active : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {option.label}
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs tabular-nums">{option.count}</span>
                </button>
            ))}
        </div>
    );
}
