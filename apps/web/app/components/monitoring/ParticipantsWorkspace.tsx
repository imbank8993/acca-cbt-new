'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Calculator, ChevronDown, Loader2, MoreHorizontal } from 'lucide-react';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { AttemptHistoryModal } from '@/app/components/monitoring/AttemptHistoryModal';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { IrtParametersPanel } from '@/app/components/monitoring/IrtParametersPanel';
import { ItemAnalysisPanel } from '@/app/components/monitoring/ItemAnalysisPanel';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { ResetExamModal } from '@/app/components/monitoring/ResetExamModal';
import { ScreenShareExceptionsPanel } from '@/app/components/monitoring/ScreenShareExceptionsPanel';
import { Button } from '@/app/components/ui/button';
import { FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import './monitoring.css';
import { activeMonitoringRows } from '@/lib/active-monitoring';
import { calculateExamIRT } from '@/lib/api/grading';
import {
    finishAttemptAction,
    getExamAnswersForAnalysisAction,
    getExamAttemptsAction,
    type ExamAttemptRecord,
    type ItemAnalysis,
    type OrganizationExam,
} from '@/lib/api/proctor';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import type { IrtCalibration } from '@/lib/irt-calibration';
import { buildItemAnalysis } from '@/lib/item-analysis';
import { formatStudentName } from '@/lib/monitoring-health';
import { effectiveRoomFilter, matchesRoomFilter, monitoringRoomOptions } from '@/lib/monitoring-rooms';
import { getSchoolTimeZone } from '@/lib/school-time';

export type WorkspaceSection = 'peserta' | 'jawaban' | 'hasil' | 'analisis' | 'berita';
export type WorkspaceRole = 'admin' | 'proktor' | 'pengawas' | 'guru';

const SECTION_LABELS: Record<WorkspaceSection, string> = {
    peserta: 'Peserta', jawaban: 'Jawaban', hasil: 'Hasil', analisis: 'Analisis', berita: 'Berita Acara',
};
const FINISHED = ['submitted', 'auto_submitted', 'finished', 'completed', 'selesai'];

type StatusFilter = 'all' | 'working' | 'waiting' | 'finished' | 'attention';
const STATUS_FILTERS: Array<[StatusFilter, string]> = [
    ['all', 'Semua'], ['working', 'Mengerjakan'], ['waiting', 'Belum masuk'], ['finished', 'Selesai'], ['attention', 'Perlu perhatian'],
];

/** Status pengerjaan untuk filter Peserta. */
export function attemptState(attempt: Pick<ExamAttemptRecord, 'status'>): 'working' | 'finished' | 'waiting' {
    if (attempt.status === 'in_progress') return 'working';
    if (FINISHED.includes(attempt.status)) return 'finished';
    return 'waiting';
}

/** Ringkasan satu baris: total, mengerjakan, selesai, belum masuk, perlu perhatian. */
export function participantSummary(attempts: ExamAttemptRecord[]) {
    const working = attempts.filter(row => attemptState(row) === 'working').length;
    const finished = attempts.filter(row => attemptState(row) === 'finished').length;
    return {
        total: attempts.length, working, finished,
        waiting: attempts.length - working - finished,
        attention: activeMonitoringRows(attempts, 'attention').length,
    };
}

export function ParticipantSummaryLine({ attempts, fallbackTotal }: { attempts: ExamAttemptRecord[]; fallbackTotal?: number }) {
    const summary = participantSummary(attempts);
    const total = summary.total || fallbackTotal || 0;
    return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600" aria-label="Ringkasan peserta">
        <span><strong className="tabular-nums text-slate-900">{total}</strong> peserta</span>
        <span className="text-slate-300" aria-hidden="true">·</span>
        <span><strong className="tabular-nums text-blue-700">{summary.working}</strong> mengerjakan</span>
        <span className="text-slate-300" aria-hidden="true">·</span>
        <span><strong className="tabular-nums text-emerald-700">{summary.finished}</strong> selesai</span>
        <span className="text-slate-300" aria-hidden="true">·</span>
        <span><strong className="tabular-nums text-slate-900">{Math.max(0, total - summary.working - summary.finished)}</strong> belum masuk</span>
        <span className="text-slate-300" aria-hidden="true">·</span>
        <span className={summary.attention ? 'rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800' : undefined}>
            <strong className="tabular-nums">{summary.attention}</strong> perlu perhatian
        </span>
    </p>;
}

/**
 * Ruang kerja peserta yang sama untuk tampilan "Per ruang" dan "Per bank soal" ujian
 * ASAS/AM: satu baris tab (Peserta, Jawaban, Hasil, Analisis, Berita Acara), filter
 * dalam satu baris, dan tindakan yang jarang dipakai (reset massal, pengecualian
 * layar) di menu Tindakan.
 */
export function ParticipantsWorkspace({
    attempts, examOptions, examRecords, userRole, sections, loading, attemptBasePath, onReload,
    administration, showRoomFilter = false, exportTitle, trailing,
}: {
    attempts: ExamAttemptRecord[];
    examOptions: Array<{ exam_id: string; label: string }>;
    examRecords: Record<string, OrganizationExam>;
    userRole: WorkspaceRole;
    sections: WorkspaceSection[];
    loading: boolean;
    attemptBasePath?: string;
    onReload: () => Promise<void> | void;
    administration?: ReactNode;
    showRoomFilter?: boolean;
    exportTitle: string;
    /** Kontrol tambahan di ujung kanan baris tab (mis. pilihan Per bank soal | Per ruang). */
    trailing?: ReactNode;
}) {
    const router = useRouter();
    const [section, setSection] = useState<WorkspaceSection>(sections[0]);
    const [action, setAction] = useState<'reset' | 'screen' | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [status, setStatus] = useState<StatusFilter | null>(null);
    const [search, setSearch] = useState('');
    const [classFilter, setClassFilter] = useState('');
    const [roomFilter, setRoomFilter] = useState('');
    const [focusExamId, setFocusExamId] = useState(examOptions[0]?.exam_id || '');
    const [analysis, setAnalysis] = useState<{ examId: string; items: ItemAnalysis[]; irt: IrtCalibration | null; error?: string } | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [resetAttempt, setResetAttempt] = useState<ExamAttemptRecord | null>(null);
    const [busy, setBusy] = useState(false);
    const analysisRequest = useRef(0);
    const menuRef = useRef<HTMLDivElement>(null);

    const activeSection = sections.includes(section) ? section : sections[0];
    const focusId = examOptions.some(option => option.exam_id === focusExamId) ? focusExamId : examOptions[0]?.exam_id || '';
    const focusExam = examRecords[focusId];
    const focusLabel = examOptions.find(option => option.exam_id === focusId)?.label || '';
    const staff = userRole === 'admin' || userRole === 'proktor';
    const canReset = (examId: string) => userRole !== 'guru' && examRecords[examId]?.canResetParticipants === true;
    const anyReset = examOptions.some(option => canReset(option.exam_id));
    // Guru mapel hanya memantau: tanpa reset maupun pengecualian layar.
    const screenExams = userRole === 'guru' ? [] : examOptions.filter(option => examRecords[option.exam_id]?.canManage === true && examRecords[option.exam_id]?.metadata?.screenshot_enabled === true);
    const viewAnswers = attemptBasePath ? (id: string) => router.push(`${attemptBasePath}/${encodeURIComponent(id)}`) : undefined;

    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [menuOpen]);

    // ── Filter bersama ──────────────────────────────────────────────────────
    const classOptions = useMemo(() => [...new Set(attempts.flatMap(row => String(row.kelas_name || '').split(',').map(name => name.trim()).filter(name => name && name !== '-')))]
        .sort((a, b) => a.localeCompare(b, 'id', { numeric: true })), [attempts]);
    const roomOptions = useMemo(() => showRoomFilter ? monitoringRoomOptions(attempts) : [], [attempts, showRoomFilter]);
    const room = effectiveRoomFilter(roomFilter, roomOptions);
    const klass = classOptions.includes(classFilter) ? classFilter : '';
    const query = search.trim().toLocaleLowerCase('id-ID');
    const scoped = attempts
        .filter(row => matchesRoomFilter(row, room))
        .filter(row => !klass || String(row.kelas_name || '').split(',').map(name => name.trim()).includes(klass))
        .filter(row => !query || [row.profiles?.full_name, row.profiles?.identity_number, row.kelas_name, examOptions.find(option => option.exam_id === row.exam_id)?.label]
            .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
    const summary = participantSummary(scoped);
    const effectiveStatus: StatusFilter = status ?? (summary.working > 0 ? 'working' : 'all');
    const statusCount: Record<StatusFilter, number> = {
        all: scoped.length, working: summary.working, waiting: summary.waiting, finished: summary.finished, attention: summary.attention,
    };

    const finish = staff ? async (attempt: ExamAttemptRecord, reason: string) => {
        const result = await finishAttemptAction(attempt.id, reason);
        if (!result.success) return result.error || 'Pengerjaan belum dapat diselesaikan.';
        await onReload();
        return null;
    } : undefined;
    const recover = (attempt: ExamAttemptRecord) => { if (canReset(attempt.exam_id) && attempt.canReset === true) setResetAttempt(attempt); };

    const loadAnalysis = useCallback(async (examId: string) => {
        if (!examId) return;
        const id = ++analysisRequest.current;
        setAnalysisLoading(true);
        try {
            const [data, examAttempts] = await Promise.all([getExamAnswersForAnalysisAction(examId), getExamAttemptsAction(examId)]);
            if (id === analysisRequest.current) setAnalysis({ examId, items: buildItemAnalysis(data, examAttempts), irt: data.irt ?? null });
        } catch (loadError) {
            if (id === analysisRequest.current) setAnalysis({ examId, items: [], irt: null, error: loadError instanceof Error ? loadError.message : 'Analisis belum dapat dimuat.' });
        } finally {
            if (id === analysisRequest.current) setAnalysisLoading(false);
        }
    }, []);

    const openSection = (next: WorkspaceSection) => {
        setAction(null);
        setSection(next);
        if (next === 'analisis' && analysis?.examId !== focusId) void loadAnalysis(focusId);
    };
    const changeFocus = (examId: string) => {
        setFocusExamId(examId);
        if (activeSection === 'analisis' && !action) void loadAnalysis(examId);
    };

    const exportResults = async () => {
        if (!focusId) return;
        setBusy(true);
        try {
            const [freshAttempts, freshAnalysis, timeZone] = await Promise.all([
                getExamAttemptsAction(focusId), getExamAnswersForAnalysisAction(focusId), getSchoolTimeZone(),
            ]);
            if (!freshAttempts.length) throw new Error('Data peserta belum tersedia. Muat ulang monitoring sebelum export.');
            if (freshAttempts.some(a => a.status !== 'belum') && (freshAnalysis.questions.length || freshAttempts.some(a => (a.total_questions || 0) > 0)) && !freshAnalysis.detailed) {
                throw new Error('Analisis rinci belum tersedia. Coba kembali setelah layanan penilaian tersedia.');
            }
            await exportDetailedAnalysisToExcel({
                exam: focusExam, attempts: freshAttempts, analysis: [], detailedAnalysis: freshAnalysis.detailed, timeZone,
                questions: freshAnalysis.questions, answers: freshAnalysis.answers, irt: freshAnalysis.irt ?? null,
            });
        } catch (exportError) {
            await alertDialog({ title: 'Export Belum Berhasil', text: exportError instanceof Error ? exportError.message : 'Export belum dapat dibuat.', variant: 'danger' });
        } finally {
            setBusy(false);
        }
    };

    const calculateIrt = async () => {
        if (!focusId) return;
        const confirmed = await confirmDialog({
            title: 'Kalkulasi Skor IRT?',
            text: `Nilai seluruh peserta ${focusLabel || 'ujian ini'} dihitung ulang berdasarkan tingkat kesukaran butir soal.`,
            confirmText: 'Ya, Hitung Skor IRT',
            variant: 'primary',
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const result = await calculateExamIRT(focusId);
            await alertDialog(result.success
                ? { title: 'Kalkulasi IRT Selesai', text: `${result.count ?? 0} skor peserta telah diperbarui.${result.warnings?.length ? `\n\nPeringatan:\n${result.warnings.map(warning => `• ${warning}`).join('\n')}` : ''}`, variant: 'success' }
                : { title: 'Gagal Kalkulasi IRT', text: result.error || 'Terjadi kesalahan sistem', variant: 'danger' });
            await onReload();
            if (analysis?.examId === focusId) void loadAnalysis(focusId);
        } finally {
            setBusy(false);
        }
    };

    const hasIrt = String(focusExam?.scoring_type || '').split(',').some(type => type.trim().startsWith('irt'));
    const examPicker = (label: string) => examOptions.length > 1 && <label className="flex items-center gap-2 text-xs font-medium text-slate-600">{label}
        <InlineSelect value={focusId} onChange={changeFocus} minWidth="220px" aria-label={label}
            options={examOptions.map(option => ({ value: option.exam_id, label: option.label }))} />
    </label>;
    const showFilters = !action && ['peserta', 'jawaban', 'hasil'].includes(activeSection);
    const actions = [
        ...(anyReset ? [['reset', 'Reset massal'] as const] : []),
        ...(screenExams.length ? [['screen', 'Pengecualian layar'] as const] : []),
    ];
    const peopleRows = [...scoped].filter(row => effectiveStatus === 'all' || attemptState(row) === effectiveStatus)
        .sort((a, b) => String(a.profiles?.full_name || '').localeCompare(String(b.profiles?.full_name || ''), 'id'));

    return <div className="monitoring-participants-workspace">
        <div className="monitoring-section-bar flex flex-wrap items-end justify-between gap-2 border-b border-slate-200">
            <nav className="monitoring-section-tabs -mb-px flex gap-1 overflow-x-auto" aria-label="Bagian monitoring">
                {sections.map(id => <button key={id} type="button" aria-pressed={!action && activeSection === id} onClick={() => openSection(id)}
                    className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${!action && activeSection === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                    {SECTION_LABELS[id]}
                </button>)}
            </nav>
            {(actions.length > 0 || trailing) && <div className="mb-1.5 ml-auto flex items-center gap-2">
            {actions.length > 0 && <div ref={menuRef} className="relative">
                <Button type="button" variant="outline" size="sm" aria-haspopup="menu" className="monitoring-actions-trigger" aria-label="Tindakan" leftIcon={<MoreHorizontal size={18} className="sm:hidden" />} aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}
                    rightIcon={<ChevronDown size={14} className={`hidden sm:block transition-transform ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />}>
                    Tindakan
                </Button>
                {menuOpen && <div role="menu" aria-label="Tindakan" className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    {actions.map(([id, label]) => <button key={id} type="button" role="menuitem" onClick={() => { setAction(id); setMenuOpen(false); }}
                        className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                        <span className="text-sm font-medium text-slate-800">{label}</span>
                        <span className="text-[11px] text-slate-500">{id === 'reset' ? 'Buka ulang pengerjaan beberapa peserta' : 'Izinkan peserta tanpa berbagi layar'}</span>
                    </button>)}
                </div>}
            </div>}
            {trailing}
            </div>}
        </div>

        {showFilters && <FilterToolbar>
            <FilterSearch value={search} onChange={setSearch} placeholder="Cari nama, NIS, atau kelas…" grow={2} width="240px" />
            {classOptions.length > 1 && <FilterSelect label="Kelas" icon="people" value={klass} onChange={setClassFilter} width="150px"
                options={[{ value: '', label: 'Semua kelas' }, ...classOptions.map(name => ({ value: name, label: name }))]} />}
            {roomOptions.length > 0 && <FilterSelect label="Ruang" icon="door-open" value={room} onChange={setRoomFilter} width="170px"
                options={[{ value: '', label: 'Semua ruang' }, ...roomOptions.map(option => ({ value: option.value, label: `${option.label} (${option.count})` }))]} />}
        </FilterToolbar>}

        {action ? <div className="space-y-3">
            <button type="button" onClick={() => setAction(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                <ArrowLeft size={13} />Kembali ke {SECTION_LABELS[activeSection]}
            </button>
            {action === 'reset'
                ? <BulkResetPanel attempts={scoped.filter(row => canReset(row.exam_id))}
                    examDuration={Math.max(0, ...examOptions.map(option => examRecords[option.exam_id]?.duration_minutes ?? examRecords[option.exam_id]?.duration ?? 0)) || undefined}
                    onRefresh={() => void onReload()} />
                : screenExams.map(option => <section key={option.exam_id} className="space-y-2" aria-label={`Pengecualian layar ${option.label}`}>
                    {screenExams.length > 1 && <h3 className="text-xs font-bold text-slate-700">{option.label}</h3>}
                    <ScreenShareExceptionsPanel examId={option.exam_id} attempts={attempts.filter(row => row.exam_id === option.exam_id)} onChanged={() => void onReload()} />
                </section>)}
        </div>
        : activeSection === 'berita' ? administration
        : activeSection === 'analisis' ? <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {examPicker('Ujian')}
                <p className="text-[11px] text-slate-500">Mencakup seluruh peserta {focusLabel || 'ujian ini'}.</p>
            </div>
            {analysisLoading && analysis?.examId !== focusId ? <Placeholder text="Memuat analisis…" />
                : analysis?.examId === focusId && analysis.error ? <ErrorLine text={analysis.error} onRetry={() => void loadAnalysis(focusId)} />
                : <>
                    <IrtParametersPanel key={`irt-${focusId}`} calibration={analysis?.examId === focusId ? analysis.irt : null}
                        scoringType={focusExam?.scoring_type} exportTitle={`${exportTitle} ${examOptions.length > 1 ? focusLabel : ''}`.trim()} />
                    <ItemAnalysisPanel key={focusId} analysis={analysis?.examId === focusId ? analysis.items : []} />
                </>}
        </div>
        : loading && !attempts.length ? <Placeholder text="Memuat peserta…" />
        : activeSection === 'peserta' ? <div className="monitoring-participants-list">
            <div role="group" aria-label="Filter status" className="monitoring-status-filters flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={effectiveStatus === id} onClick={() => setStatus(id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${effectiveStatus === id
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : id === 'attention' && statusCount.attention > 0 ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {label}<span className={`rounded-full px-1.5 text-[10px] tabular-nums ${effectiveStatus === id ? 'bg-white/25' : 'bg-slate-100'}`}>{statusCount[id]}</span>
                </button>)}
            </div>
            {effectiveStatus === 'working' || effectiveStatus === 'attention'
                ? <ActiveParticipantsPanel attempts={scoped.filter(row => attemptState(row) === 'working')} attentionOnly={effectiveStatus === 'attention'}
                    onFinish={finish} onViewDetails={viewAnswers} />
                : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto" role="region" aria-label="Daftar peserta" tabIndex={0}><table className="monitoring-participants-table w-full text-left text-xs sm:min-w-[640px]">
                        <thead className="bg-slate-50 text-[11px] text-slate-500"><tr>
                            <th scope="col" className="p-3 font-semibold sm:px-4">Peserta</th>
                            <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">Kelas</th>
                            <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">{showRoomFilter ? 'Ruang' : 'Ujian'}</th>
                            <th scope="col" className="p-3 font-semibold sm:px-4">Status</th>
                            <th scope="col" className="hidden px-4 py-3 text-right font-semibold sm:table-cell">Terjawab</th>
                            <th scope="col" className="hidden px-4 py-3 text-right font-semibold sm:table-cell">Peringatan</th>
                        </tr></thead>
                        <tbody>{peopleRows.map(row => {
                            const state = attemptState(row);
                            return <tr key={`${row.exam_id}:${row.id}`} onClick={() => setSelectedKey(`${row.exam_id}:${row.id}`)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                                <td className="p-3 font-medium text-slate-900 sm:px-4"><button type="button" className="monitoring-participant-name" onClick={event => { event.stopPropagation(); setSelectedKey(`${row.exam_id}:${row.id}`); }}>{formatStudentName(row.profiles?.full_name, 'Peserta')}</button>
                                    <div className="text-[11px] font-normal text-slate-500">{row.profiles?.identity_number || '—'}<span className="sm:hidden"> · {row.kelas_name || '—'}</span></div>
                                    <div className="monitoring-participant-meta sm:hidden">
                                        {showRoomFilter && <span>{row.pas_location?.room_name || 'Belum ditempatkan'}</span>}
                                        <span>{row.saved_answer_count ?? '—'} / {row.total_questions ?? '—'} terjawab{(row.warning_count || 0) > 0 && ` · ${row.warning_count} peringatan`}</span>
                                    </div></td>
                                <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{row.kelas_name || '—'}</td>
                                <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{showRoomFilter ? (row.pas_location?.room_name || 'Belum ditempatkan') : (examOptions.find(option => option.exam_id === row.exam_id)?.label || '—')}</td>
                                <td className="p-3 sm:px-4"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state === 'finished' ? 'bg-emerald-50 text-emerald-700' : state === 'working' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {state === 'finished' ? 'Selesai' : state === 'working' ? 'Mengerjakan' : 'Belum masuk'}</span></td>
                                <td className="hidden px-4 py-2.5 text-right tabular-nums text-slate-600 sm:table-cell">{row.saved_answer_count ?? '—'} / {row.total_questions ?? '—'}</td>
                                <td className="hidden px-4 py-2.5 text-right tabular-nums text-slate-600 sm:table-cell">{row.warning_count || 0}</td>
                            </tr>;
                        })}</tbody>
                    </table></div>
                    {!peopleRows.length && <p className="px-4 py-10 text-center text-sm text-slate-500">Tidak ada peserta yang cocok.</p>}
                </div>}
            <AttemptHistoryModal
                open={Boolean(selectedKey)}
                attempt={attempts.find(row => `${row.exam_id}:${row.id}` === selectedKey) || null}
                onClose={() => setSelectedKey(null)}
                showSessionDetails
                onViewAnswers={viewAnswers}
            />
        </div>
        : activeSection === 'jawaban' ? <MonitoringHealthPanel attempts={scoped} defaultExpanded
            onRecover={anyReset ? recover : undefined} onViewDetails={viewAnswers} />
        : <div className="monitoring-results">
            <div className="monitoring-results__toolbar">
                {examOptions.length > 1 && <label className="monitoring-results__scope">
                    <span>Tindakan untuk</span>
                    <InlineSelect value={focusId} onChange={changeFocus} minWidth="0" height="36px" aria-label="Tindakan untuk"
                        options={examOptions.map(option => ({ value: option.exam_id, label: option.label }))} />
                </label>}
                <div className="monitoring-results__actions">
                    {focusExam?.canManage === true && focusExam.canCorrectKeys !== false && focusId && <ExamKeyCorrectionButton key={focusId} examId={focusId} onComplete={() => void onReload()} />}
                    {hasIrt && focusExam?.canManage === true && <Button variant="outline" size="sm" onClick={() => void calculateIrt()} disabled={busy} leftIcon={<Calculator size={14} />}>Kalkulasi IRT</Button>}
                    <Button variant="outline" size="sm" icon="export" onClick={() => void exportResults()} disabled={busy || !focusId}>Export</Button>
                </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <MonitoringResultsTable attempts={scoped.filter(row => row.status !== 'in_progress')} hasAnyAttempts={attempts.length > 0} showRoomInfo={showRoomFilter}
                    onViewDetails={id => viewAnswers?.(id)} onRecover={anyReset ? recover : undefined} />
            </div>
        </div>}

        <ResetExamModal
            open={Boolean(resetAttempt) && resetAttempt?.canReset === true}
            attempt={resetAttempt}
            examDuration={resetAttempt ? (examRecords[resetAttempt.exam_id]?.duration_minutes ?? examRecords[resetAttempt.exam_id]?.duration) : undefined}
            onClose={() => setResetAttempt(null)}
            onSuccess={() => void onReload()}
        />
    </div>;
}

function Placeholder({ text }: { text: string }) {
    return <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{text}</div>;
}

function ErrorLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
    return <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{text}
        {onRetry && <button type="button" className="ml-auto font-semibold underline" onClick={onRetry}>Coba lagi</button>}</div>;
}

export { ErrorLine as WorkspaceError, Placeholder as WorkspacePlaceholder };
