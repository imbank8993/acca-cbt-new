'use client';

import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { SearchableSelect } from '@/app/components/ui/SearchableSelect';
import type { OrganizationExam } from '@/lib/api/proctor';
import { folderExamParts, isMonitoringExamActive, monitoringAssessmentPeriod, monitoringExamLabel, monitoringExamDetails, monitoringFolderName, sortMonitoringExams,
    monitoringExamBadge } from '@/lib/monitoring-exams';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import './monitoring-exam-picker.css';

const OTHER_EXAMS = '__other__';
type ExamPhase = 'active' | 'upcoming' | 'done';
const PHASE_LABELS: Record<ExamPhase, string> = { active: 'Sedang berlangsung', upcoming: 'Akan datang', done: 'Selesai' };

function examPhase(exam: OrganizationExam, now: number): ExamPhase {
    if (isMonitoringExamActive(exam, now)) return 'active';
    const start = exam.start_time ? Date.parse(exam.start_time) : NaN;
    return Number.isFinite(start) && start > now && !['finished', 'completed', 'cancelled', 'archived'].includes(exam.status || '') ? 'upcoming' : 'done';
}

const subjectOf = (exam: OrganizationExam) => exam.subject?.trim() || folderExamParts(exam)?.bank || exam.title;
const sameText = (a: string, b: string) => a.localeCompare(b, 'id', { sensitivity: 'base' }) === 0;

/**
 * Label pilihan kedua: "Bahasa Indonesia · Kelas XI D" untuk ujian folder, judul ujian untuk ujian biasa.
 * Satu mapel dapat punya lebih dari satu bank soal (mis. wajib dan peminatan). Bila mapelnya
 * kembar di asesmen yang sama, nama bank soal ikut ditampilkan agar pilihannya dapat dibedakan:
 * "Bahasa Indonesia — B. Indonesia Peminatan · Kelas XI D".
 */
function memberLabel(exam: OrganizationExam, members: OrganizationExam[]): string {
    const folder = folderExamParts(exam);
    if (!folder) return monitoringExamLabel(exam);
    const subject = subjectOf(exam);
    const twin = members.some(other => other.id !== exam.id && folderExamParts(other) && sameText(subjectOf(other), subject));
    const name = twin && folder.bank && !sameText(folder.bank, subject) ? `${subject} — ${folder.bank}` : twin && folder.bank ? folder.bank : subject;
    return `${name} · Kelas ${folder.className}`;
}

/**
 * Pemilih ujian bertingkat: (1) asesmen/folder atau "Ujian lainnya", lalu (2) mapel dan kelas
 * yang dikelompokkan menurut status. Tampilan Per ruang hanya memakai tingkat pertama karena
 * ruang dipilih di papan ruang.
 */
export default function MonitoringExamPicker({ exams, now, value, onChange, hideContext = false, folderLevel = false, slotRef }: {
    /** Tidak dipakai lagi; dipertahankan agar pemanggil lama tetap valid. */
    detailsOnRight?: boolean;
    /** Tampilan Per ruang folder ASAS/AM: cukup pilih folder, bukan satu bank soal. */
    folderLevel?: boolean;
    hideContext?: boolean;
    /** Tidak dipakai lagi; dipertahankan agar pemanggil lama tetap valid. */
    compactContext?: boolean;
    exams: OrganizationExam[];
    now: number;
    value: string;
    onChange: (value: unknown) => void;
    /** Tempat pemilih tambahan sebaris (mis. Ruang · Sesi pada tampilan Per ruang). */
    slotRef?: (element: HTMLDivElement | null) => void;
}) {
    const { timeZone, error } = useSchoolTimeZone();
    const [openDetailsFor, setOpenDetailsFor] = useState<string | null>(null);
    const detailsRef = useRef<HTMLDivElement>(null);
    const visible = sortMonitoringExams(exams, now);
    const selected = exams.find(exam => exam.id === value);
    const groupOf = (exam: OrganizationExam) => folderPeriodId(exam) || OTHER_EXAMS;
    const activeGroup = selected ? groupOf(selected) : '';

    // Tingkat 1: satu pilihan per folder (yang berlangsung lebih dulu), lalu "Ujian lainnya".
    const groups: Array<{ value: string; label: string; active: boolean }> = [];
    for (const exam of visible) {
        const id = groupOf(exam);
        const existing = groups.find(group => group.value === id);
        if (existing) { existing.active ||= isMonitoringExamActive(exam, now); continue; }
        groups.push({ value: id, label: id === OTHER_EXAMS ? 'Ujian lainnya' : monitoringFolderName(exam), active: isMonitoringExamActive(exam, now) });
    }
    groups.sort((a, b) => Number(a.value === OTHER_EXAMS) - Number(b.value === OTHER_EXAMS));

    // Tingkat 2: anggota kelompok terpilih, dikelompokkan menurut status.
    const members = activeGroup && !(folderLevel && activeGroup !== OTHER_EXAMS) ? visible.filter(exam => groupOf(exam) === activeGroup) : [];
    const phases = (['active', 'upcoming', 'done'] as const).map(phase => ({ phase, items: members.filter(exam => examPhase(exam, now) === phase) }))
        .filter(group => group.items.length);

    const choose = (next: string) => { setOpenDetailsFor(null); onChange(next); };
    const chooseGroup = (group: string) => {
        if (group === activeGroup) return;
        const first = visible.find(exam => groupOf(exam) === group);
        if (first) choose(first.id);
    };

    const selectedFolder = selected ? folderExamParts(selected) : null;
    const detailsOpen = Boolean(selected && openDetailsFor === value);
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
    const badge = selected ? monitoringExamBadge(selected) : null;
    const questionCreators = selected?.questionCreatorNames?.length ? selected.questionCreatorNames.join(', ') : 'Belum tercatat';
    const examCreator = selected?.examCreatorName || (!badge ? selected?.creatorName : null) || 'Belum tercatat';
    const phase = selected ? examPhase(selected, now) : 'done';
    const details: Array<[string, string]> = !selected ? [] : selectedFolder ? [
        ['Nama folder', monitoringFolderName(selected)],
        ['Mata pelajaran', selected.subject?.trim() || 'Belum tercatat'],
        ['Kelas', selectedFolder.className],
        ['Bank soal', selectedFolder.bank],
        ['Pembuat bank soal', questionCreators],
        ['Pembuat ujian', examCreator],
        ...(schoolYear ? [['Tahun ajaran', schoolYear] as [string, string]] : []),
        ...(assessment ? [['Jenis asesmen', assessment] as [string, string]] : []),
        ['Jadwal', schedule(selected) || 'Belum tersedia'],
    ] : [
        ['Ujian', monitoringExamLabel(selected)],
        ...(monitoringExamDetails(selected) ? [['Keterangan', monitoringExamDetails(selected)] as [string, string]] : []),
        ['Jadwal', schedule(selected) || 'Belum tersedia'],
        ['Pembuat soal', questionCreators],
        ['Pembuat ujian', examCreator],
    ];
    const showMembers = members.length > 0;

    return <div className="monitoring-exam-picker">
        <div className="monitoring-exam-picker__controls monitoring-exam-picker__tiers">
            <InlineSelect aria-label="Asesmen" title="Pilih asesmen" className="monitoring-exam-picker__tier" minWidth="200px" height="42px"
                value={activeGroup} onChange={chooseGroup} disabled={!groups.length}>
                {!activeGroup && <option value="">{groups.length ? 'Pilih asesmen' : 'Tidak ada ujian'}</option>}
                {groups.map(group => <option key={group.value} value={group.value}>{group.active ? `● ${group.label}` : group.label}</option>)}
            </InlineSelect>
            {/* Bisa diketik untuk mencari: satu asesmen bisa berisi puluhan mapel/kelas. */}
            {showMembers && <SearchableSelect ariaLabel={activeGroup === OTHER_EXAMS ? 'Ujian' : 'Mata pelajaran dan kelas'}
                className="monitoring-exam-picker__tier monitoring-exam-picker__tier--grow monitoring-exam-picker__search"
                placeholder={activeGroup === OTHER_EXAMS ? 'Pilih ujian' : 'Pilih mata pelajaran dan kelas'}
                searchPlaceholder="Ketik mapel, nama ujian, atau kelas…" portal keepHighlightedVisible
                value={value} onChange={next => { if (next != null && next !== '') choose(String(next)); }}
                options={phases.flatMap(group => group.items.map(exam => ({
                    value: exam.id,
                    label: memberLabel(exam, members),
                    // Urutan tetap per fase; fase selain Selesai diberi penanda.
                    badge: group.phase === 'done' ? undefined : PHASE_LABELS[group.phase],
                })))} />}
            {slotRef && <div ref={slotRef} className="monitoring-exam-picker__slot" />}
        </div>
        {selected && !hideContext && showMembers && <div ref={detailsRef} className="monitoring-exam-picker__status" aria-live="polite">
            {showMembers ? <>
                <span className={`monitoring-exam-picker__phase monitoring-exam-picker__phase--${phase}`}>{PHASE_LABELS[phase]}</span>
                {schedule(selected) && <span className="monitoring-exam-picker__schedule">{schedule(selected)}</span>}
                <button type="button" className="monitoring-exam-picker__detail-trigger"
                    aria-label="Lihat detail ujian" title="Lihat detail ujian"
                    aria-expanded={detailsOpen} aria-controls="monitoring-exam-detail-popover"
                    onClick={() => setOpenDetailsFor(detailsOpen ? null : value)}>
                    <Info size={14} aria-hidden="true" /> Detail
                </button>
            </> : null}
            {detailsOpen && <div id="monitoring-exam-detail-popover" role="dialog" aria-labelledby="monitoring-exam-detail-title"
                className="monitoring-exam-picker__detail-popover">
                <div className="monitoring-exam-picker__detail-head">
                    <strong id="monitoring-exam-detail-title">Detail ujian</strong>
                    <button type="button" aria-label="Tutup detail" onClick={() => setOpenDetailsFor(null)}><X size={16} aria-hidden="true" /></button>
                </div>
                <dl>{details.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
            </div>}
        </div>}
    </div>;
}

function folderPeriodId(exam: OrganizationExam): string {
    const id = exam.metadata?.pas_period_id;
    return typeof id === 'string' ? id : '';
}
