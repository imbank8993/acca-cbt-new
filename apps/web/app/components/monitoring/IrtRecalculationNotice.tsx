'use client';

import { AlertTriangle } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { irtRecalculationStatus } from '@/lib/irt-status';

/** Pengingat bahwa skor IRT perlu dihitung ulang setelah pemulihan/susulan. */
export function IrtRecalculationNotice({ attempts, scoringType, canCalculate }: {
    attempts: ExamAttemptRecord[];
    scoringType?: string | null;
    canCalculate: boolean;
}) {
    const status = irtRecalculationStatus(attempts, scoringType);
    if (!status.missing && !status.recovering) return null;
    return (
        <div role="status" className="mb-3.5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <AlertTriangle size={16} className="shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 leading-snug">
                {status.missing > 0 && (
                    <p>
                        <strong>{status.missing} peserta belum memiliki skor IRT.</strong>{' '}
                        {canCalculate
                            ? 'Buka tab Hasil lalu tekan "Kalkulasi IRT".'
                            : 'Minta pengelola ujian melakukan "Kalkulasi IRT".'}
                    </p>
                )}
                {status.recovering > 0 && (
                    <p className={status.missing > 0 ? 'mt-1' : ''}>
                        <strong>{status.recovering} peserta susulan.</strong> Hitung ulang IRT setelah peserta selesai.
                    </p>
                )}
            </div>
        </div>
    );
}
