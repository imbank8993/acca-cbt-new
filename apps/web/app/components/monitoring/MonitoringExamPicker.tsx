'use client';

import { useState, type ReactNode } from 'react';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import type { OrganizationExam } from '@/lib/api/proctor';
import { isMonitoringExamActive, monitoringExamLabel, monitoringExamDetails, sortMonitoringExams,
    monitoringExamBadge, filterMonitoringExams, type MonitoringExamCategory } from '@/lib/monitoring-exams';
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
    const [category, setCategory] = useState<MonitoringExamCategory>('all');
    const visible = sortMonitoringExams(filterMonitoringExams(exams, category), now);
    const selected = exams.find(exam => exam.id === value);
    const schedule = (exam: OrganizationExam) => {
        const duration = exam.duration_minutes ?? exam.duration;
        return [
            exam.start_time && !error ? formatSchoolDateTime(exam.start_time, timeZone) : '',
            typeof duration === 'number' && duration > 0 ? `${duration} menit` : '',
        ].filter(Boolean).join(' · ');
    };
    const changeCategory = (next: string) => {
        const nextCategory = next as MonitoringExamCategory;
        setCategory(nextCategory);
        const filtered = sortMonitoringExams(filterMonitoringExams(exams, nextCategory), now);
        if (value && !filtered.some(exam => exam.id === value)) onChange(filtered[0]?.id || '');
    };
    const badge = selected ? monitoringExamBadge(selected) : null;
    const questionCreators = selected?.questionCreatorNames?.length ? selected.questionCreatorNames.join(', ') : 'Belum tercatat';
    const examCreator = selected?.examCreatorName || (!badge ? selected?.creatorName : null) || 'Belum tercatat';

    return <div className={`monitoring-exam-picker ${detailsOnRight ? 'monitoring-exam-picker--aside' : ''}`}>
        <div className={`monitoring-exam-picker__controls ${action ? 'has-action' : ''}`}>
            <SearchableSelect
                className="w-full"
                placeholder={visible.length ? 'Cari atau pilih ujian...' : 'Tidak ada ujian pada kategori ini'}
                searchPlaceholder="Cari ujian, bank soal, kelas, atau periode..."
                options={visible.map(exam => ({
                    value: exam.id,
                    label: monitoringExamLabel(exam),
                    badge: monitoringExamBadge(exam) || undefined,
                    subLabel: [monitoringExamDetails(exam), schedule(exam)].filter(Boolean).join(' · '),
                    statusDot: isMonitoringExamActive(exam, now) ? 'Ujian aktif' : undefined,
                }))}
                value={value}
                onChange={onChange}
            />
            <InlineSelect aria-label="Kategori ujian" value={category} onChange={changeCategory} minWidth="0" height="42px"
                options={[{ value: 'all', label: 'Semua ujian' }, { value: 'assessment', label: 'ASAS/AM' }, { value: 'other', label: 'Lainnya' }]} />
            {action}
        </div>
        {selected && !hideContext && <div className="monitoring-exam-picker__context" aria-live="polite">
            <div className="monitoring-exam-picker__identity">
                {badge && <span className="monitoring-exam-picker__kind">{badge}</span>}
                <strong className={compactContext ? 'monitoring-exam-picker__mobile-title' : undefined}>{monitoringExamLabel(selected)}</strong>
                {monitoringExamDetails(selected) && <span className="monitoring-exam-picker__description">{monitoringExamDetails(selected)}</span>}
            </div>
            <dl className="monitoring-exam-picker__metadata">
                {[
                    ['Jadwal', schedule(selected) || 'Belum tersedia'],
                    ['Pembuat soal', questionCreators],
                    ['Pembuat ujian', examCreator],
                ].map(([label, detail]) => <div key={label}>
                    <dt>{label}</dt><dd>{detail}</dd>
                </div>)}
            </dl>
        </div>}
    </div>;
}
