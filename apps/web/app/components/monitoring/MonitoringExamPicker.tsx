'use client';

import type { ReactNode } from 'react';
import SearchableSelect from '@/components/ui/SearchableSelect';
import type { OrganizationExam } from '@/lib/api/proctor';
import { isMonitoringExamActive, monitoringExamLabel, monitoringExamDetails, sortMonitoringExams } from '@/lib/monitoring-exams';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import './monitoring-exam-picker.css';

export default function MonitoringExamPicker({ exams, now, value, onChange, compactContext = false, detailsOnRight = false, hideContext = false, action }: {
    detailsOnRight?: boolean;
    hideContext?: boolean;
    action?: ReactNode;
    compactContext?: boolean;
    exams: OrganizationExam[];
    now: number;
    value: string;
    onChange: (value: unknown) => void;
}) {
    const { timeZone, error } = useSchoolTimeZone();
    const selected = exams.find(exam => exam.id === value);
    const schedule = (exam: OrganizationExam) => {
        const duration = exam.duration_minutes ?? exam.duration;
        return [
            exam.start_time && !error ? formatSchoolDateTime(exam.start_time, timeZone) : '',
            typeof duration === 'number' && duration > 0 ? `${duration} menit` : '',
        ].filter(Boolean).join(' · ');
    };
    return (
        <div className={`monitoring-exam-picker ${detailsOnRight ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start' : ''}`}>
            <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
            <SearchableSelect
                className="w-full"
                placeholder="Cari atau pilih ujian..."
                searchPlaceholder="Cari ujian, bank soal, kelas, atau periode..."
                options={sortMonitoringExams(exams, now).map(exam => ({
                    value: exam.id,
                    label: monitoringExamLabel(exam),
                    subLabel: [monitoringExamDetails(exam), schedule(exam)].filter(Boolean).join(' · '),
                    statusDot: isMonitoringExamActive(exam, now) ? 'Ujian aktif' : undefined,
                }))}
                value={value}
                onChange={onChange}
            />
            </div>
            {action}
            </div>
            {selected && !hideContext && detailsOnRight && (
                <dl aria-live="polite" className="grid min-w-0 grid-cols-2 gap-2">
                    {[
                        ['Detail ujian', monitoringExamDetails(selected) || '—'],
                        ['Jadwal', selected.start_time && !error ? formatSchoolDateTime(selected.start_time, timeZone) : 'Belum tersedia'],
                        ['Durasi', (selected.duration_minutes ?? selected.duration) ? `${selected.duration_minutes ?? selected.duration} menit` : '—'],
                    ].map(([label, detail], index) => (
                        <div key={label} className={`min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-2.5 ${index === 0 ? 'col-span-2' : ''}`}>
                            <dt className="text-[11px] text-slate-500">{label}</dt>
                            <dd className="mt-1 break-words text-xs font-medium leading-relaxed text-slate-700">{detail}</dd>
                        </div>
                    ))}
                </dl>
            )}
            {selected && !hideContext && !detailsOnRight && (
                <div className="monitoring-exam-picker__context" aria-live="polite">
                    {!compactContext && <p className="font-semibold text-slate-700 dark:text-slate-200">{monitoringExamLabel(selected)}</p>}
                    {monitoringExamDetails(selected) && <p>{monitoringExamDetails(selected)}</p>}
                    {schedule(selected) && <p>{schedule(selected)}</p>}
                </div>
            )}
        </div>
    );
}
