'use client';

import SearchableSelect from '@/components/ui/SearchableSelect';
import type { OrganizationExam } from '@/lib/api/proctor';
import { isMonitoringExamActive, monitoringExamLabel, monitoringExamDetails, sortMonitoringExams } from '@/lib/monitoring-exams';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import './monitoring-exam-picker.css';

export default function MonitoringExamPicker({ exams, now, value, onChange }: {
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
        <div className="monitoring-exam-picker">
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
            {selected && (
                <div className="monitoring-exam-picker__context" aria-live="polite">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{monitoringExamLabel(selected)}</p>
                    {monitoringExamDetails(selected) && <p>{monitoringExamDetails(selected)}</p>}
                    {schedule(selected) && <p>{schedule(selected)}</p>}
                </div>
            )}
        </div>
    );
}
