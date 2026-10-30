'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ExamAttemptRecord, OrganizationExam } from '@/lib/api/proctor';
import { activeMonitoringRows } from '@/lib/active-monitoring';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import MonitoringExamPicker from './MonitoringExamPicker';
import './monitoring.css';

interface MonitoringWorkspaceHeaderProps {
    exams: OrganizationExam[];
    now: number;
    value: string;
    onExamChange: (value: string) => void;
    onRefresh: () => void;
    refreshing: boolean;
    attempts: ExamAttemptRecord[];
    activeTab: string;
    onTabChange: (value: string) => void;
    tabs: { id: string; label: string }[];
    /** Ujian folder ASAS/AM: ringkasan & tab diurus oleh tampilan per bank/ruang di `children`. */
    hideDetails?: boolean;
    /** Kontrol di pojok kanan atas, sebaris dengan pemilih ujian (mis. Per bank soal | Per ruang). */
    headerAction?: ReactNode;
    children?: ReactNode;
}

export function MonitoringWorkspaceHeader({
    exams, now, value, onExamChange, onRefresh, refreshing, attempts,
    activeTab, onTabChange, tabs, hideDetails = false, headerAction, children,
}: MonitoringWorkspaceHeaderProps) {
    const selectedAttempts = attempts.filter(attempt => attempt.exam_id === value);
    const sample = selectedAttempts[0]?.server_now;
    const [clock, setClock] = useState<{ sample?: string; elapsed: number }>({ elapsed: 0 });
    const elapsed = clock.sample === sample ? clock.elapsed : 0;
    const tabsRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const started = performance.now();
        const timer = window.setInterval(() => setClock({ sample, elapsed: Math.floor((performance.now() - started) / 1000) }), 1000);
        return () => window.clearInterval(timer);
    }, [sample, value]);

    useEffect(() => {
        const container = tabsRef.current;
        if (!container) return;
        const activeBtn = container.querySelector('[aria-pressed="true"]') as HTMLElement | null;
        if (activeBtn) {
            activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        }
    }, [activeTab]);

    const stats = [
        { label: 'Total peserta', value: selectedAttempts.length },
        { label: 'Mengerjakan', value: selectedAttempts.filter(attempt => attempt.status === 'in_progress').length },
        { label: 'Selesai', value: selectedAttempts.filter(attempt => ['submitted', 'auto_submitted'].includes(attempt.status)).length },
        { label: 'Belum mulai', value: selectedAttempts.filter(attempt => attempt.status === 'belum').length },
        { label: 'Perlu perhatian', value: activeMonitoringRows(selectedAttempts, 'attention', elapsed).length, attention: true },
    ];

    return (
        <div className="monitoring-workspace">
            <header className="monitoring-workspace__heading">
                <div className="monitoring-workspace__picker">
                    <MonitoringExamPicker
                        exams={exams}
                        now={now}
                        value={value}
                        onChange={id => {
                            const nextId = String(id || '');
                            if (['admin', 'administration'].includes(activeTab) && !hasMonitoringAdministration(exams.find(exam => exam.id === nextId))) {
                                onTabChange('live');
                            }
                            onExamChange(nextId);
                        }}
                        compactContext
                        action={
                            <button type="button" className="monitoring-refresh" onClick={onRefresh}
                                disabled={refreshing || !value} aria-label="Perbarui data monitoring" title="Perbarui data monitoring">
                                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            </button>
                        }
                    />
                </div>
                {headerAction && <div className="monitoring-workspace__action">{headerAction}</div>}
            </header>
            {value && hideDetails && children}
            {value && !hideDetails && <>
                    <dl className="monitoring-summary" aria-label="Ringkasan peserta ujian">
                        {stats.map(stat => <div key={stat.label} className={stat.attention && stat.value > 0 ? 'monitoring-summary__attention' : undefined}>
                            <dt>{stat.label}</dt><dd>{stat.value}</dd>
                        </div>)}
                    </dl>
                <nav ref={tabsRef} className="monitoring-workspace__tabs" aria-label="Bagian monitoring">
                    {tabs.map(tab => <button type="button" key={tab.id}
                        aria-pressed={activeTab === tab.id} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}
                </nav>
                {children}
            </>}
        </div>
    );
}
