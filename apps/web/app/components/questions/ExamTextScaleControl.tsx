"use client";

import { Minus, Plus } from 'lucide-react';
import { EXAM_TEXT_SCALES, stepExamTextScale } from '@/lib/exam-text-scale';

/** A− 100% A+ control for the question text size. The middle button resets to 100%. */
export function ExamTextScaleControl({ scale, onChange, compact = false }: {
    scale: number;
    onChange: (scale: number) => void;
    compact?: boolean;
}) {
    const percent = Math.round(scale * 100);
    const button = `${compact ? 'w-8 h-8' : 'w-9 h-9'} flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 transition-all hover:bg-white hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white disabled:opacity-40 disabled:hover:bg-transparent`;
    return (
        <div role="group" aria-label="Ukuran teks soal" data-exam-text-scale
            className={`flex items-center shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800/80 ${compact ? 'p-0.5' : 'p-1.5 gap-0.5'}`}>
            <button type="button" className={button} disabled={scale <= EXAM_TEXT_SCALES[0]}
                onClick={() => onChange(stepExamTextScale(scale, -1))}
                aria-label="Perkecil teks soal" title="Perkecil teks soal">
                <span className="text-[11px] font-bold leading-none">A</span><Minus size={9} strokeWidth={3} />
            </button>
            {!compact && (
                <button type="button" onClick={() => onChange(1)}
                    className="h-9 min-w-[3rem] rounded-md px-1 text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400 transition-all hover:bg-white hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white"
                    aria-label={`Ukuran teks ${percent}%. Klik untuk kembali ke 100%`} title="Kembalikan ukuran teks ke 100%">
                    {percent}%
                </button>
            )}
            <button type="button" className={button} disabled={scale >= EXAM_TEXT_SCALES[EXAM_TEXT_SCALES.length - 1]}
                onClick={() => onChange(stepExamTextScale(scale, 1))}
                aria-label="Perbesar teks soal" title={compact ? `Perbesar teks soal (sekarang ${percent}%)` : 'Perbesar teks soal'}>
                <span className="text-sm font-bold leading-none">A</span><Plus size={9} strokeWidth={3} />
            </button>
        </div>
    );
}
