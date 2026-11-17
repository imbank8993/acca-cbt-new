'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import type { OrganizationExam } from '@/lib/api/proctor';
import { folderExamParts, isMonitoringExamActive, monitoringAssessmentPeriod, monitoringExamLabel, monitoringExamDetails, monitoringFolderName, sortMonitoringExams,
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
    const [openDetailsFor, setOpenDetailsFor] = useState<string | null>(null);
    const detailsRef = useRef<HTMLDivElement>(null);
    const visible = sortMonitoringExams(filterMonitoringExams(exams, category), now);
    const selected = exams.find(exam => exam.id === value);
    const selectedFolder = selected ? folderExamParts(selected) : null;
    const detailsOpen = Boolean(selectedFolder && openDetailsFor === value);
    const periodParts = selectedFolder?.period.split(' · ').filter(Boolean) || [];
    const schoolYear = periodParts.find(part => /^\d{4}\/\d{4}$/.test(part));
    const assessment = monitoringAssessmentPeriod(periodParts.filter(part => part !== schoolYear).join(' · '));

    useEffect(() => {
        if (!detailsOpen) return;
        const closeOutside = (event: PointerEvent) => {
            if (!detailsRef.current?.contains(event.target as Node)) setOpenDetailsFor(null);
        };
        const closeEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenDetailsFor(null);
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeEscape);
        };
    }, [detailsOpen]);
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
        setOpenDetailsFor(null);
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
                options={visible.map(exam => {
                    const folder = folderExamParts(exam);
                    return {
                        value: exam.id,
                        label: folder ? monitoringFolderName(exam) : monitoringExamLabel(exam),
                        subLabel: folder
                            ? [folder.bank, `Kelas ${folder.className}`, schedule(exam)].filter(Boolean).join(' · ')
                            : [monitoringExamDetails(exam), schedule(exam)].filter(Boolean).join(' · '),
                        statusDot: isMonitoringExamActive(exam, now) ? 'Ujian aktif' : undefined,
                    };
                })}
                value={value}
                onChange={next => { setOpenDetailsFor(null); onChange(next); }}
            />
            <InlineSelect aria-label="Kategori ujian" value={category} onChange={changeCategory} minWidth="0" height="42px"
                options={[{ value: 'all', label: 'Semua ujian' }, { value: 'assessment', label: 'ASAS/AM' }, { value: 'other', label: 'Lainnya' }]} />
            {action}
        </div>
        {selected && !hideContext && <div className="monitoring-exam-picker__context" aria-live="polite">
            {selectedFolder ? <div ref={detailsRef} className="monitoring-exam-picker__detail-anchor">
                <div className="monitoring-exam-picker__detail-summary">
                    <span>{selected.subject?.trim() || 'Mapel belum tercatat'}</span>
                    <span aria-hidden="true" className="monitoring-exam-picker__detail-separator">|</span>
                    <span>{selectedFolder.className}</span>
                </div>
                <button type="button" className="monitoring-exam-picker__detail-trigger"
                    aria-label="Lihat detail folder ujian" title="Lihat detail folder ujian"
                    aria-expanded={detailsOpen} aria-controls="monitoring-folder-detail-popover"
                    onClick={() => setOpenDetailsFor(detailsOpen ? null : value)}>
                    <Info size={15} aria-hidden="true" /> Detail
                </button>
                {detailsOpen && <div id="monitoring-folder-detail-popover" role="dialog" aria-labelledby="monitoring-folder-detail-title"
                    className="monitoring-exam-picker__detail-popover">
                    <div className="monitoring-exam-picker__detail-head">
                        <strong id="monitoring-folder-detail-title">Detail folder ujian</strong>
                        <button type="button" aria-label="Tutup detail folder" onClick={() => setOpenDetailsFor(null)}><X size={16} aria-hidden="true" /></button>
                    </div>
                    <dl>
                        {[
                            ['Nama folder', monitoringFolderName(selected)],
                            ['Mata pelajaran', selected.subject?.trim() || 'Belum tercatat'],
                            ['Kelas', selectedFolder.className],
                            ['Bank soal', selectedFolder.bank],
                            ['Pembuat bank soal', questionCreators],
                            ['Pembuat ujian', examCreator],
                            ...(schoolYear ? [['Tahun ajaran', schoolYear]] : []),
                            ...(assessment ? [['Jenis asesmen', assessment]] : []),
                            ['Jadwal', schedule(selected) || 'Belum tersedia'],
                        ].map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}
                    </dl>
                </div>}
            </div> : <>
                <div className="monitoring-exam-picker__identity">
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
            </>}
        </div>}
    </div>;
}
