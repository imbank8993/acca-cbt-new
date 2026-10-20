'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ExamAttemptRecord, OrganizationExam } from '@/lib/api/proctor';
import { activeMonitoringRows } from '@/lib/active-monitoring';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
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
    children?: ReactNode;
}

export function MonitoringWorkspaceHeader({
    exams, now, value, onExamChange, onRefresh, refreshing, attempts,
    activeTab, onTabChange, tabs, children,
}: MonitoringWorkspaceHeaderProps) {
    const { timeZone, error } = useSchoolTimeZone();
    const selected = exams.find(exam => exam.id === value);
    const selectedAttempts = attempts.filter(attempt => attempt.exam_id === value);
    const sample = selectedAttempts[0]?.server_now;
    const [clock, setClock] = useState<{ sample?: string; elapsed: number }>({ elapsed: 0 });
    const elapsed = clock.sample === sample ? clock.elapsed : 0;

    useEffect(() => {
        const started = performance.now();
        const timer = window.setInterval(() => setClock({ sample, elapsed: Math.floor((performance.now() - started) / 1000) }), 1000);
        return () => window.clearInterval(timer);
    }, [sample, value]);

    const duration = selected?.duration_minutes ?? selected?.duration;
    const schedule = [
        selected?.start_time && !error ? formatSchoolDateTime(selected.start_time, timeZone) : '',
        typeof duration === 'number' && duration > 0 ? `${duration} menit` : '',
    ].filter(Boolean).join(' · ');
    const stats = [
        { label: 'Total peserta', value: selectedAttempts.length },
        { label: 'Mengerjakan', value: selectedAttempts.filter(attempt => attempt.status === 'in_progress').length },
        { label: 'Selesai', value: selectedAttempts.filter(attempt => ['submitted', 'auto_submitted'].includes(attempt.status)).length },
        { label: 'Perlu perhatian', value: activeMonitoringRows(selectedAttempts, 'attention', elapsed).length, attention: true },
    ];
    const resettableCount = selectedAttempts.filter(attempt =>
        attempt.canReset === true && ['submitted', 'auto_submitted'].includes(attempt.status)
    ).length;

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
                        hideContext
                        action={
                            <button type="button" className="monitoring-refresh" onClick={onRefresh}
                                disabled={refreshing || !value} aria-label="Perbarui data monitoring" title="Perbarui data monitoring">
                                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            </button>
                        }
                    />
                </div>
                {schedule && <p className="monitoring-workspace__schedule">{schedule}</p>}
            </header>
            {value && <>
                {activeTab === 'reset' ? (
                    <div className="monitoring-reset-summary" aria-label={`${resettableCount} siswa dapat direset`}>
                        <strong>{resettableCount}</strong><span>Dapat direset</span>
                    </div>
                ) : (
                    <dl className="monitoring-summary" aria-label="Ringkasan peserta ujian">
                        {stats.map(stat => <div key={stat.label} className={stat.attention && stat.value > 0 ? 'monitoring-summary__attention' : undefined}>
                            <dt>{stat.label}</dt><dd>{stat.value}</dd>
                        </div>)}
                    </dl>
                )}
                <nav className="monitoring-workspace__tabs" aria-label="Bagian monitoring">
                    {tabs.map(tab => <button type="button" key={tab.id}
                        aria-pressed={activeTab === tab.id} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}
                </nav>
                {children}
            </>}
        </div>
    );
}
