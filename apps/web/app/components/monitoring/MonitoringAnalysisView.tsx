'use client';

import { useState, type ReactNode } from 'react';
import { InlineSelect } from '@/app/components/ui/inlineselect';

/** Keep the two analysis methods in separate views, including before IRT is calculated. */
export function MonitoringAnalysisView({ hasIrt, irt, children }: {
    hasIrt: boolean;
    irt: ReactNode;
    children: ReactNode;
}) {
    const [selected, setSelected] = useState(hasIrt ? 'irt' : 'classical');
    const active = hasIrt ? selected : 'classical';

    return <div className="min-w-0 space-y-3">
        {hasIrt && <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Jenis analisis</span>
            <InlineSelect aria-label="Jenis analisis" value={active} onChange={setSelected}
                minWidth="180px" options={[
                    { value: 'irt', label: 'IRT' },
                    { value: 'classical', label: 'Klasikal' },
                ]} />
        </div>}
        {active === 'irt' ? irt : children}
    </div>;
}
