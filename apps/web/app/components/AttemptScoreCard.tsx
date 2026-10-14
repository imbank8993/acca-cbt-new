'use client';

import { BarChart3 } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { monitoringScoreModels } from '@/lib/monitoring-score-models';

export function AttemptScoreCard({ attempt }: { attempt: ExamAttemptRecord }) {
    return (
        <div className="bg-white p-5 rounded-lg border border-[#3083FF]/20 shadow-sm relative overflow-hidden">
            <div className="flex justify-between items-start mb-3">
                <span className="text-sm font-bold text-slate-500">Nilai Ujian{attempt.status === 'in_progress' ? ' · Sementara' : ''}</span>
                <div className="w-8 h-8 bg-[#3083FF]/10 rounded-lg flex items-center justify-center text-[#3083FF]">
                    <BarChart3 size={16} />
                </div>
            </div>
            <div className="space-y-3">
                {monitoringScoreModels(attempt).map(model => (
                    <div key={model.type}>
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-500">{model.label}</span>
                            {model.score === null ? (
                                <span className="text-xs text-slate-400 text-right">{model.pendingLabel}</span>
                            ) : (
                                <span className="text-lg font-bold text-[#3083FF] tabular-nums">
                                    {model.score.toFixed(2)}<span className="ml-1 text-xs text-slate-400">/100</span>
                                </span>
                            )}
                        </div>
                        {model.score !== null && (
                            <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#3083FF] rounded-full" style={{ width: `${model.score}%` }} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
