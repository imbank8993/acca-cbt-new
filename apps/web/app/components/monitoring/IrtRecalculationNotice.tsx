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
        <div role="status" className="mb-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-1">
                {status.missing > 0 && (
                    <p>
                        <strong>{status.missing} peserta belum memiliki skor IRT.</strong>{' '}
                        Nilai mereka tampil kosong, mereka tidak masuk peringkat, dan pembahasan ujian ini tertutup
                        untuk semua peserta sampai IRT dihitung ulang.{' '}
                        {canCalculate
                            ? 'Buka tab Hasil lalu tekan "Kalkulasi IRT". Nilai IRT peserta lain dapat bergeser sedikit.'
                            : 'Minta pengelola ujian menekan "Kalkulasi IRT".'}
                    </p>
                )}
                {status.recovering > 0 && (
                    <p>
                        {status.recovering} peserta sedang dalam pemulihan/susulan. Hitung ulang IRT setelah mereka
                        selesai mengirim; peserta yang masih mengerjakan tidak ikut dihitung.
                    </p>
                )}
            </div>
        </div>
    );
}
