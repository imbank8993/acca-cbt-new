import { Award } from 'lucide-react';
import type { StudentResult } from '@/lib/api/students';
import { dashboardScoreSummaries } from '@/lib/student-dashboard-score';

export function StudentScoreAverages({ results }: { results: StudentResult[] }) {
    const summaries = dashboardScoreSummaries(results);
    return <div className={"relative flex items-start gap-3.5 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 shadow-indigo-500/20 p-5 text-white shadow-md"}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <Award size={18} />
        </div>
        <div className="min-w-0 flex-1">
            <p className="mb-3 text-sm font-medium text-white/85">Rata-rata nilai</p>
            {summaries.length ? <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {summaries.map(summary => <div key={summary.type}>
                    <dt className="mb-1 text-xs font-semibold text-white/85">{summary.label}</dt>
                    <dd className="text-3xl font-bold leading-none tabular-nums">
                        {summary.average}
                        <span className="ml-1 text-xs font-normal text-white/75">{summary.type === 'classical' ? '/100' : '200–800'}</span>
                    </dd>
                    <p className="mt-1 text-[11px] text-white/80">Dari {summary.count} ujian</p>
                </div>)}
            </dl> : <p className="text-sm text-white/85">Belum ada nilai yang tersedia.</p>}
        </div>
    </div>;
}
