'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, BookOpen, Calculator, Loader2, RefreshCw } from 'lucide-react';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { IrtParametersPanel } from '@/app/components/monitoring/IrtParametersPanel';
import { ItemAnalysisPanel } from '@/app/components/monitoring/ItemAnalysisPanel';
import { MonitoringParticipantFilters } from '@/app/components/monitoring/MonitoringParticipantFilters';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { ResetExamModal } from '@/app/components/monitoring/ResetExamModal';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import type { PASPeriod } from '@/app/types/pas';
import { calculateExamIRT } from '@/lib/api/grading';
import {
    getExamAnswersForAnalysisAction,
    getExamAttemptsAction,
    listOrganizationExams,
    type ExamAttemptRecord,
    type ItemAnalysis,
    type OrganizationExam,
} from '@/lib/api/proctor';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import type { IrtCalibration } from '@/lib/irt-calibration';
import { buildItemAnalysis, type ExamAnalysisData } from '@/lib/item-analysis';
import { effectiveRoomFilter, matchesRoomFilter, monitoringRoomOptions } from '@/lib/monitoring-rooms';
import { getSchoolTimeZone } from '@/lib/school-time';

export interface FolderBankExams {
    bankId: string;
    title: string;
    classes: string[];
    examIds: string[];
}

/** Bank soal folder beserta ujian yang sudah dibangkitkan (satu, atau beberapa untuk folder lama/sesi berbeda). */
export function folderBankExams(period: Pick<PASPeriod, 'pas_class_schedules'>): FolderBankExams[] {
    const banks = new Map<string, FolderBankExams>();
    for (const schedule of period.pas_class_schedules || []) {
        if (!schedule.bank_id || !schedule.exam_id) continue;
        const row = banks.get(schedule.bank_id) || { bankId: schedule.bank_id, title: schedule.question_banks?.title?.trim() || 'Bank soal', classes: [], examIds: [] };
        const className = schedule.classes?.name?.replace(/^kelas\s+/i, '');
        if (className && !row.classes.includes(className)) row.classes.push(className);
        if (!row.examIds.includes(schedule.exam_id)) row.examIds.push(schedule.exam_id);
        banks.set(schedule.bank_id, row);
    }
    return [...banks.values()]
        .map(row => ({ ...row, classes: row.classes.sort((a, b) => a.localeCompare(b, 'id', { numeric: true })) }))
        .sort((a, b) => a.title.localeCompare(b.title, 'id', { numeric: true }));
}

/** Analisis gabungan beberapa ujian dari bank yang sama: soal sama, jawaban digabung. */
export function combineAnalysisData(parts: ExamAnalysisData[]): ExamAnalysisData {
    if (parts.length === 1) return parts[0];
    return { questions: parts.find(part => part.questions.length)?.questions || [], answers: parts.flatMap(part => part.answers), detailed: null };
}

/**
 * Tab "Hasil & Analisis" folder: hasil, analisis butir, export, koreksi kunci,
 * dan IRT per BANK SOAL — seluruh kelas yang mengerjakan bank itu dalam satu daftar.
 */
export function PASBankResultsPanel({ period, attemptBasePath }: { period: PASPeriod; attemptBasePath: string }) {
    const router = useRouter();
    const banks = useMemo(() => folderBankExams(period), [period]);
    const [bankId, setBankId] = useState('');
    const bank = banks.find(item => item.bankId === bankId) || banks[0];
    const [view, setView] = useState<'results' | 'analysis'>('results');
    const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
    const [exams, setExams] = useState<Record<string, OrganizationExam>>({});
    const [analysis, setAnalysis] = useState<{ key: string; items: ItemAnalysis[]; irt: Array<{ examId: string; calibration: IrtCalibration | null }> } | null>(null);
    const [loading, setLoading] = useState(false);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [classFilter, setClassFilter] = useState<string[]>([]);
    const [roomFilter, setRoomFilter] = useState('');
    const [status, setStatus] = useState('all');
    const [actionExamId, setActionExamId] = useState('');
    const [resetAttempt, setResetAttempt] = useState<ExamAttemptRecord | null>(null);
    const request = useRef(0);
    const bankKey = bank ? `${bank.bankId}:${bank.examIds.join(',')}` : '';

    const load = useCallback(async () => {
        if (!bank) return;
        const id = ++request.current;
        setLoading(true);
        setError('');
        try {
            const lists = await Promise.all(bank.examIds.map(examId => getExamAttemptsAction(examId)));
            if (id === request.current) setAttempts(lists.flat());
        } catch (loadError) {
            if (id === request.current) setError(loadError instanceof Error ? loadError.message : 'Hasil belum dapat dimuat.');
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, [bank]);

    const loadAnalysis = useCallback(async () => {
        if (!bank) return;
        setAnalysisLoading(true);
        setError('');
        try {
            const [parts, lists] = await Promise.all([
                Promise.all(bank.examIds.map(examId => getExamAnswersForAnalysisAction(examId))),
                Promise.all(bank.examIds.map(examId => getExamAttemptsAction(examId))),
            ]);
            setAnalysis({
                key: `${bank.bankId}:${bank.examIds.join(',')}`,
                items: buildItemAnalysis(combineAnalysisData(parts), lists.flat()),
                irt: parts.map((part, index) => ({ examId: bank.examIds[index], calibration: part.irt ?? null })),
            });
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Analisis belum dapat dimuat.');
        } finally {
            setAnalysisLoading(false);
        }
    }, [bank]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    useEffect(() => {
        let active = true;
        listOrganizationExams()
            .then(list => { if (active) setExams(Object.fromEntries(list.map(exam => [exam.id, exam]))); })
            .catch(() => { /* Tanpa data ujian, tombol yang butuh izin disembunyikan. */ });
        return () => { active = false; };
    }, []);

    const changeBank = (next: string) => {
        setBankId(next);
        setAttempts([]);
        setAnalysis(null);
        setClassFilter([]);
        setRoomFilter('');
        setActionExamId('');
        if (view === 'analysis') setView('results');
    };
    const openAnalysis = () => {
        setView('analysis');
        if (analysis?.key !== bankKey) void loadAnalysis();
    };

    if (!bank) {
        return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <BookOpen size={28} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">Belum ada ujian yang dibangkitkan</p>
            <p className="mt-1 text-xs text-slate-500">Hasil dan analisis muncul setelah jadwal bank soal dibangkitkan atau diaktifkan.</p>
        </div>;
    }

    const actionExam = exams[actionExamId] || exams[bank.examIds[0]];
    const actionId = actionExam?.id || bank.examIds[0];
    const examClassLabel = (examId: string) => {
        const description = exams[examId]?.description || '';
        return /Kelas\s+([^|]+)/.exec(description)?.[1]?.trim() || examId.slice(0, 8);
    };
    const canReset = (examId: string) => exams[examId]?.canResetParticipants === true;
    const hasIrt = String(actionExam?.scoring_type || '').split(',').some(type => type.trim().startsWith('irt'));
    const classOptions = [...new Set(attempts.flatMap(row => String(row.kelas_name || '').split(',').map(name => name.trim()).filter(name => name && name !== '-')))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    const roomOptions = monitoringRoomOptions(attempts);
    const room = effectiveRoomFilter(roomFilter, roomOptions);
    const query = search.trim().toLowerCase();
    const filtered = attempts
        .filter(row => matchesRoomFilter(row, room))
        .filter(row => !query || [row.profiles?.full_name, row.profiles?.identity_number].some(value => String(value || '').toLowerCase().includes(query)))
        .filter(row => !classFilter.length || String(row.kelas_name || '').split(',').map(name => name.trim()).some(name => classFilter.includes(name)))
        .filter(row => status === 'all' || row.status === status);
    const counts = {
        total: attempts.length,
        finished: attempts.filter(row => ['submitted', 'auto_submitted'].includes(row.status)).length,
        working: attempts.filter(row => row.status === 'in_progress').length,
    };

    const exportResults = async () => {
        setBusy(true);
        try {
            const [freshAttempts, freshAnalysis, timeZone] = await Promise.all([
                getExamAttemptsAction(actionId), getExamAnswersForAnalysisAction(actionId), getSchoolTimeZone(),
            ]);
            if (!freshAttempts.length) throw new Error('Data peserta belum tersedia.');
            if (freshAttempts.some(a => a.status !== 'belum') && (freshAnalysis.questions.length || freshAttempts.some(a => (a.total_questions || 0) > 0)) && !freshAnalysis.detailed) {
                throw new Error('Analisis rinci belum tersedia. Coba kembali setelah layanan penilaian tersedia.');
            }
            await exportDetailedAnalysisToExcel({
                exam: actionExam, attempts: freshAttempts, analysis: [], detailedAnalysis: freshAnalysis.detailed, timeZone,
                questions: freshAnalysis.questions, answers: freshAnalysis.answers, irt: freshAnalysis.irt ?? null,
            });
        } catch (exportError) {
            await alertDialog({ title: 'Export Belum Berhasil', text: exportError instanceof Error ? exportError.message : 'Export belum dapat dibuat.', variant: 'danger' });
        } finally {
            setBusy(false);
        }
    };

    const calculateIrt = async () => {
        const confirmed = await confirmDialog({
            title: 'Kalkulasi Skor IRT?',
            text: `Nilai seluruh peserta ${bank.title}${bank.examIds.length > 1 ? ` (${examClassLabel(actionId)})` : ''} dihitung ulang berdasarkan tingkat kesukaran butir soal.`,
            confirmText: 'Ya, Hitung Skor IRT',
            variant: 'primary',
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const result = await calculateExamIRT(actionId);
            await alertDialog(result.success
                ? { title: 'Kalkulasi IRT Selesai', text: `${result.count ?? 0} skor peserta telah diperbarui.${result.warnings?.length ? `\n\nPeringatan:\n${result.warnings.map(warning => `• ${warning}`).join('\n')}` : ''}`, variant: 'success' }
                : { title: 'Gagal Kalkulasi IRT', text: result.error || 'Terjadi kesalahan sistem', variant: 'danger' });
            await load();
        } finally {
            setBusy(false);
        }
    };

    return <section className="space-y-4" aria-label="Hasil dan analisis per bank soal">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <InlineSelect value={bank.bankId} onChange={changeBank} minWidth="260px" aria-label="Pilih bank soal"
                        options={banks.map(item => ({ value: item.bankId, label: item.title }))} />
                    <p className="text-xs text-slate-500">Kelas {bank.classes.join(', ') || '-'}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div role="group" aria-label="Tampilan" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                        {([['results', 'Hasil'], ['analysis', 'Analisis']] as const).map(([id, label]) =>
                            <button key={id} type="button" aria-pressed={view === id} onClick={() => id === 'analysis' ? openAnalysis() : setView('results')}
                                className={`rounded-md px-3 py-1.5 ${view === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>)}
                    </div>
                    <button type="button" onClick={() => void (view === 'analysis' ? loadAnalysis() : load())} disabled={loading || analysisLoading}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        <RefreshCw size={13} className={loading || analysisLoading ? 'animate-spin' : ''} />Perbarui
                    </button>
                </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
                {[['Peserta', counts.total], ['Selesai', counts.finished], ['Mengerjakan', counts.working]].map(([label, value]) =>
                    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{value}</dd></div>)}
            </dl>
            {bank.examIds.length > 1 && <p className="mt-3 text-[11px] text-amber-700">
                Bank soal ini masih terdiri dari {bank.examIds.length} ujian (per kelas atau per sesi). Hasil ditampilkan gabungan; Export, koreksi kunci, dan IRT dijalankan per ujian.
            </p>}
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}

        {view === 'results' ? <>
            <MonitoringParticipantFilters
                search={search} onSearchChange={setSearch}
                classOptions={classOptions} selectedClasses={classFilter} onClassesChange={setClassFilter}
                roomOptions={roomOptions} selectedRoom={room} onRoomChange={setRoomFilter}
                status={status} onStatusChange={setStatus} includeActiveStatus={false}
                actions={<>
                    {bank.examIds.length > 1 && <InlineSelect value={actionId} onChange={setActionExamId} minWidth="160px" aria-label="Ujian untuk tindakan"
                        options={bank.examIds.map(examId => ({ value: examId, label: `Kelas ${examClassLabel(examId)}` }))} />}
                    {actionExam?.canManage === true && actionExam.canCorrectKeys !== false && <ExamKeyCorrectionButton key={actionId} examId={actionId} onComplete={() => void load()} />}
                    {hasIrt && actionExam?.canManage === true && <Button variant="outline" onClick={() => void calculateIrt()} disabled={busy} leftIcon={<Calculator size={16} />}>Kalkulasi IRT</Button>}
                    <Button variant="outline" icon="export" onClick={() => void exportResults()} disabled={busy}>Export</Button>
                </>}
            />
            {loading && !attempts.length ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat hasil…</div>
                : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <MonitoringResultsTable attempts={filtered.filter(row => row.status !== 'in_progress')} hasAnyAttempts={attempts.length > 0} showRoomInfo
                        onViewDetails={id => router.push(`${attemptBasePath}/${encodeURIComponent(id)}`)}
                        onRecover={bank.examIds.some(canReset) ? attempt => { if (canReset(attempt.exam_id) && attempt.canReset === true) setResetAttempt(attempt); } : undefined} />
                </div>}
        </> : analysisLoading && analysis?.key !== bankKey
            ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat analisis…</div>
            : <div className="space-y-2">
                {bank.examIds.length > 1 && <p className="text-[11px] text-slate-500">Analisis gabungan dari {bank.examIds.length} ujian. Indeks kesukaran dan daya beda tersedia setelah ujian bank ini digabung (tab Pengaturan Ujian).</p>}
                {analysis?.key === bankKey && analysis.irt.map(({ examId, calibration }) =>
                    <IrtParametersPanel key={`irt-${examId}`} calibration={calibration} scoringType={exams[examId]?.scoring_type}
                        title={bank.examIds.length > 1 ? `Parameter soal IRT · Kelas ${examClassLabel(examId)}` : 'Parameter soal IRT'}
                        exportTitle={`${period.name} ${bank.title}${bank.examIds.length > 1 ? ` ${examClassLabel(examId)}` : ''}`} />)}
                <ItemAnalysisPanel key={bankKey} analysis={analysis?.key === bankKey ? analysis.items : []} />
            </div>}

        <ResetExamModal
            open={Boolean(resetAttempt) && resetAttempt?.canReset === true}
            attempt={resetAttempt}
            examDuration={resetAttempt ? (exams[resetAttempt.exam_id]?.duration_minutes ?? exams[resetAttempt.exam_id]?.duration) : undefined}
            onClose={() => setResetAttempt(null)}
            onSuccess={() => void load()}
        />
    </section>;
}
