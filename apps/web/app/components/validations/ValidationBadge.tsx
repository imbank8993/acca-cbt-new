"use client";

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import type { BankValidationSummary } from '@/lib/api/questions';
import { VALIDATION_TONE_CLASSES, validationBadgeInfo } from '@/lib/validation-status';

/** Label status validasi bank soal; tidak tampil bila bank belum pernah divalidasi. */
export function ValidationBadge({ summary, className = '' }: { summary?: BankValidationSummary | null; className?: string }) {
    const info = validationBadgeInfo(summary);
    if (!info) return null;
    return (
        <span
            title={info.title}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-semibold whitespace-nowrap ${VALIDATION_TONE_CLASSES[info.tone]} ${className}`.trim()}
        >
            <ShieldCheck size={11} aria-hidden="true" />
            {info.label}
        </span>
    );
}
