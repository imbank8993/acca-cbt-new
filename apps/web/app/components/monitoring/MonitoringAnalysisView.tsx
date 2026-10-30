'use client';

import { useState, type ReactNode } from 'react';
import type { TopicAnalysis } from '@acca-cbt/shared';
import { TopicAnalysisPanel } from './TopicAnalysisPanel';
import { InlineSelect } from '@/app/components/ui/inlineselect';

/** Separate item statistics, IRT parameters, and cohort topic mastery. */
export function MonitoringAnalysisView({ hasIrt, irt, topicAnalysis, children }: {
    hasIrt: boolean;
    irt: ReactNode;
    topicAnalysis?: TopicAnalysis | null;
    children: ReactNode | ((analysisSelector: ReactNode) => ReactNode);
}) {
    const [selected, setSelected] = useState(hasIrt ? 'irt' : 'classical');
    const active = selected === 'irt' && !hasIrt ? 'classical' : selected;

    const analysisSelector = <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span className="hidden lg:inline text-xs font-semibold text-slate-600">Jenis analisis</span>
        <InlineSelect aria-label="Jenis analisis" value={active} onChange={setSelected}
            minWidth="160px" height="38px" options={[
                ...(hasIrt ? [{ value: 'irt', label: 'IRT' }] : []),
                { value: 'classical', label: 'Klasikal' },
                { value: 'topics', label: 'Analisis Materi' },
            ]} />
    </div>;

    return <div className="min-w-0 space-y-3">
        {active === 'topics' ? <>{analysisSelector}
            {topicAnalysis ? <TopicAnalysisPanel analysis={topicAnalysis} /> :
                <p role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Analisis materi belum tersedia untuk ujian ini.</p>}
        </> : active === 'irt' ? <>{analysisSelector}{irt}</> : typeof children === 'function'
            ? children(analysisSelector)
            : <>{analysisSelector}{children}</>}
    </div>;
}
