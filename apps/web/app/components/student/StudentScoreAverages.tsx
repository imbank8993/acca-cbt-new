import { Award } from 'lucide-react';
import type { StudentResult } from '@/lib/api/students';
import { dashboardScoreSummaries } from '@/lib/student-dashboard-score';

export function StudentScoreAverages({ results }: { results: StudentResult[] }) {
    const summaries = dashboardScoreSummaries(results);
    return <div className="relative flex items-start gap-3.5 overflow-hidden rounded-2xl border border-slate-100 bg-white p-5">
        <div className="absolute left-0 top-0 h-full w-1.5 bg-[#3083FF]" />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100/50 bg-indigo-50 text-[#3083FF]">
            <Award size={18} />
        </div>
        <div className="min-w-0 flex-1">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Rata-rata Nilai</p>
            {summaries.length ? <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {summaries.map(summary => <div key={summary.type}>
                    <dt className="mb-1 text-xs font-semibold text-slate-600">{summary.label}</dt>
                    <dd className="text-2xl font-black leading-none text-slate-800 tabular-nums">
                        {summary.average}
                        <span className="ml-1 text-xs font-normal text-slate-400">{summary.type === 'classical' ? '/100' : '200–800'}</span>
                    </dd>
                    <p className="mt-1 text-[11px] text-slate-500">Dari {summary.count} ujian</p>
                </div>)}
            </dl> : <p className="text-sm text-slate-400">Belum ada nilai yang tersedia.</p>}
        </div>
    </div>;
}
