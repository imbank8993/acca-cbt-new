'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Calculator, Clock, DoorOpen, Loader2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { AttemptHistoryModal } from '@/app/components/monitoring/AttemptHistoryModal';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { IrtParametersPanel } from '@/app/components/monitoring/IrtParametersPanel';
import { ItemAnalysisPanel } from '@/app/components/monitoring/ItemAnalysisPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { ResetExamModal } from '@/app/components/monitoring/ResetExamModal';
import { ScreenShareExceptionsPanel } from '@/app/components/monitoring/ScreenShareExceptionsPanel';
import { Button } from '@/app/components/ui/button';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import { activeMonitoringRows } from '@/lib/active-monitoring';
import { calculateExamIRT } from '@/lib/api/grading';
import { listPASMonitoringSlots, type PASMonitoringSlot } from '@/lib/api/pas';
import {
    finishAttemptAction,
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
import { buildItemAnalysis } from '@/lib/item-analysis';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZone, schoolTodayDate, utcToSchoolLocalDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';

type StaffRole = 'admin' | 'proktor' | 'pengawas';

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
export const formatSlotDate = (date: string) => isDay(date)
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : date;
const hm = (value: string) => String(value || '').slice(0, 5);
const FINISHED = ['submitted', 'auto_submitted', 'finished', 'completed', 'selesai'];

/** Tanggal awal: hari ini bila ada, lalu tanggal terdekat berikutnya, lalu tanggal terakhir. */
export function pickSlotDate(dates: string[], today: string): string {
    return dates.includes(today) ? today : dates.find(date => date > today) || dates[dates.length - 1] || '';
}

/** Slot awal untuk pengawas: sesi yang sedang berjalan, lalu yang berikutnya, lalu yang pertama. */
export function pickCurrentSlot(slots: PASMonitoringSlot[], nowTime: string): PASMonitoringSlot | null {
    const mine = slots.filter(slot => slot.is_mine);
    const list = mine.length ? mine : slots;
    return list.find(slot => hm(slot.session.start_time) <= nowTime && nowTime < hm(slot.session.end_time))
        || list.find(slot => hm(slot.session.start_time) > nowTime)
        || list[0] || null;
}

/** Peserta satu ruang: gabungan beberapa ujian, disaring ke siswa yang duduk di ruang itu. */
export function slotAttempts(slot: PASMonitoringSlot, attemptsByExam: Record<string, ExamAttemptRecord[]>): ExamAttemptRecord[] {
    const seated = new Set(slot.student_ids);
    const seen = new Set<string>();
    const rows: ExamAttemptRecord[] = [];
    for (const exam of slot.exams) {
        for (const attempt of attemptsByExam[exam.exam_id] || []) {
            const inRoom = attempt.pas_location?.room_id ? attempt.pas_location.room_id === slot.room.id : seated.has(attempt.user_id);
            const key = `${attempt.exam_id}:${attempt.user_id}:${attempt.id}`;
            if (!inRoom || seen.has(key)) continue;
            seen.add(key);
            rows.push(attempt);
        }
    }
    return rows;
}

function SlotCard({ slot, active, onSelect }: { slot: PASMonitoringSlot; active: boolean; onSelect: () => void }) {
    const { total, in_progress: running, finished, not_started: waiting } = slot.counts;
    const tone = total > 0 && finished === total ? 'border-emerald-200 bg-emerald-50/50'
        : running > 0 ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white';
    return <button type="button" onClick={onSelect} aria-pressed={active}
        className={`w-full rounded-xl border p-3 text-left transition hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${tone} ${active ? 'ring-2 ring-blue-500/40' : ''}`}>
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900"><DoorOpen size={14} className="shrink-0 text-blue-600" />{slot.room.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{slot.exams.map(exam => exam.class_name).join(', ')}</p>
            </div>
            {slot.is_mine && <span className="shrink-0 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Tugas saya</span>}
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Mengerjakan</dt><dd className="font-bold tabular-nums text-blue-700">{running}</dd></div>
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Selesai</dt><dd className="font-bold tabular-nums text-emerald-700">{finished}</dd></div>
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Belum</dt><dd className="font-bold tabular-nums text-slate-700">{waiting}</dd></div>
        </dl>
        <p className="mt-2 truncate text-[11px] text-slate-500"><ShieldCheck size={11} className="mr-1 inline text-slate-400" />
            {slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : <span className="text-amber-700">Pengawas belum diatur</span>}</p>
    </button>;
}

type RoomTab = 'live' | 'list' | 'answers' | 'results' | 'analysis' | 'reset' | 'screen' | 'admin';

/** Tab monitoring ruang. Hasil & Analisis untuk Admin/Proktor; Pengecualian layar hanya bila ada ujian yang mewajibkan berbagi layar. */
export function roomTabs(userRole: StaffRole, options: { canScreen: boolean }): Array<[RoomTab, string]> {
    const staff = userRole !== 'pengawas';
    return [
        ['live', 'Peserta aktif'],
        ['list', 'Daftar peserta'],
        ['answers', 'Jawaban'],
        ...(staff ? [['results', 'Hasil'], ['analysis', 'Analisis']] as Array<[RoomTab, string]> : []),
        ['reset', 'Reset massal'],
        ...(options.canScreen ? [['screen', 'Pengecualian layar']] as Array<[RoomTab, string]> : []),
        ['admin', 'Absensi & berita acara'],
    ];
}

/** Satu entri per ujian: ujian gabungan (satu bank soal, beberapa kelas) diringkas menjadi satu. */
export function mergeSlotExams(exams: PASMonitoringSlot['exams']): PASMonitoringSlot['exams'] {
    const byExam = new Map<string, PASMonitoringSlot['exams'][number]>();
    for (const exam of exams) {
        const current = byExam.get(exam.exam_id);
        if (!current) { byExam.set(exam.exam_id, { ...exam }); continue; }
        const classes = new Set([...current.class_name.split(', '), exam.class_name]);
        current.class_name = [...classes].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })).join(', ');
        current.student_count += exam.student_count;
    }
    return [...byExam.values()];
}

function RoomMonitor({ slot, userRole, monitoringBasePath, attemptBasePath, onBack }: {
    slot: PASMonitoringSlot; userRole: StaffRole; monitoringBasePath: string; attemptBasePath?: string; onBack?: () => void;
}) {
    const router = useRouter();
    // Ujian gabungan per bank soal muncul sekali, walau dipakai beberapa kelas di ruang ini.
    const roomExams = useMemo(() => mergeSlotExams(slot.exams), [slot.exams]);
    const [attemptsByExam, setAttemptsByExam] = useState<Record<string, ExamAttemptRecord[]>>({});
    const [examRecords, setExamRecords] = useState<Record<string, OrganizationExam>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<RoomTab>('live');
    const [search, setSearch] = useState('');
    const [attentionOnly, setAttentionOnly] = useState(false);
    const [selectedAttemptKey, setSelectedAttemptKey] = useState<string | null>(null);
    const [focusExamId, setFocusExamId] = useState(roomExams[0]?.exam_id || '');
    const [analysis, setAnalysis] = useState<{ examId: string; items: ItemAnalysis[]; irt?: IrtCalibration | null; error?: string } | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [resetAttempt, setResetAttempt] = useState<ExamAttemptRecord | null>(null);
    const [busy, setBusy] = useState(false);
    const request = useRef(0);
    const analysisRequest = useRef(0);

    const load = useCallback(async (silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        setError(null);
        const results = await Promise.allSettled(roomExams.map(exam => getExamAttemptsAction(exam.exam_id)));
        if (id !== request.current) return;
        const next: Record<string, ExamAttemptRecord[]> = {};
        const failures: string[] = [];
        results.forEach((result, index) => {
            const exam = roomExams[index];
            if (result.status === 'fulfilled') next[exam.exam_id] = result.value;
            else failures.push(`${exam.class_name} (${exam.bank_title})`);
        });
        setAttemptsByExam(next);
        if (failures.length) setError(`Peserta ujian ${failures.join(', ')} belum dapat dimuat.`);
        setLoading(false);
    }, [roomExams]);

    useEffect(() => {
        setAttemptsByExam({});
        void load(false);
    }, [load]);
    useAutoRefresh(() => void load(true), REFRESH_INTERVAL.monitoring);

    // Hak akses per ujian (reset, kelola, koreksi kunci) dan pengaturannya, sama dengan monitoring ujian biasa.
    useEffect(() => {
        let active = true;
        const ids = new Set(roomExams.map(exam => exam.exam_id));
        listOrganizationExams()
            .then(list => { if (active) setExamRecords(Object.fromEntries(list.filter(exam => ids.has(exam.id)).map(exam => [exam.id, exam]))); })
            .catch(() => { /* Tanpa data ujian, aksi yang butuh izin tetap tersembunyi. */ });
        return () => { active = false; };
    }, [roomExams]);

    const examLabel = useMemo(() => new Map(roomExams.map(exam => [exam.exam_id, `${exam.class_name} · ${exam.bank_title}`])), [roomExams]);
    const attempts = useMemo(() => slotAttempts(slot, attemptsByExam), [slot, attemptsByExam]);
    const query = search.trim().toLocaleLowerCase('id-ID');
    const filtered = attempts.filter(attempt => !query || [attempt.profiles?.full_name, attempt.profiles?.identity_number, attempt.kelas_name, examLabel.get(attempt.exam_id)]
        .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
    const running = attempts.filter(attempt => attempt.status === 'in_progress').length;
    const finished = attempts.filter(attempt => FINISHED.includes(attempt.status)).length;
    const attention = activeMonitoringRows(attempts, 'attention').length;
    const canFinish = userRole !== 'pengawas';
    const canReset = (examId: string) => examRecords[examId]?.canResetParticipants === true;
    const screenExams = roomExams.filter(exam => examRecords[exam.exam_id]?.canManage === true && examRecords[exam.exam_id]?.metadata?.screenshot_enabled === true);
    const tabs = roomTabs(userRole, { canScreen: screenExams.length > 0 });
    const activeTab: RoomTab = tabs.some(([id]) => id === tab) ? tab : 'live';
    const focusExam = examRecords[focusExamId];
    const focusLabel = examLabel.get(focusExamId) || '';
    const examDuration = (examId: string) => examRecords[examId]?.duration_minutes ?? examRecords[examId]?.duration;
    const longestDuration = Math.max(0, ...roomExams.map(exam => examDuration(exam.exam_id) || 0)) || undefined;
    const viewAnswers = attemptBasePath ? (id: string) => router.push(`${attemptBasePath}/${encodeURIComponent(id)}`) : undefined;
    const recover = (attempt: ExamAttemptRecord) => {
        if (canReset(attempt.exam_id) && attempt.canReset === true) setResetAttempt(attempt);
    };

    const finish = async (attempt: ExamAttemptRecord, reason: string) => {
        const result = await finishAttemptAction(attempt.id, reason);
        if (!result.success) return result.error || 'Pengerjaan belum dapat diselesaikan.';
        await load(true);
        return null;
    };

    const loadAnalysis = useCallback(async (examId: string) => {
        if (!examId) return;
        const id = ++analysisRequest.current;
        setAnalysisLoading(true);
        try {
            const [data, examAttempts] = await Promise.all([getExamAnswersForAnalysisAction(examId), getExamAttemptsAction(examId)]);
            if (id === analysisRequest.current) setAnalysis({ examId, items: buildItemAnalysis(data, examAttempts), irt: data.irt ?? null });
        } catch (loadError) {
            if (id === analysisRequest.current) setAnalysis({ examId, items: [], error: loadError instanceof Error ? loadError.message : 'Analisis belum dapat dimuat.' });
        } finally {
            if (id === analysisRequest.current) setAnalysisLoading(false);
        }
    }, []);

    const openTab = (next: RoomTab) => {
        setTab(next);
        if (next === 'analysis' && analysis?.examId !== focusExamId) void loadAnalysis(focusExamId);
    };
    const changeFocusExam = (examId: string) => {
        setFocusExamId(examId);
        if (activeTab === 'analysis') void loadAnalysis(examId);
    };

    const exportResults = async () => {
        if (!focusExamId) return;
        setBusy(true);
        try {
            const [freshAttempts, freshAnalysis, timeZone] = await Promise.all([
                getExamAttemptsAction(focusExamId), getExamAnswersForAnalysisAction(focusExamId), getSchoolTimeZone(),
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
        if (!focusExamId) return;
        const confirmed = await confirmDialog({
            title: 'Kalkulasi Skor IRT?',
            text: `Nilai seluruh peserta ${focusLabel} akan dihitung ulang berdasarkan tingkat kesulitan butir soal.`,
            confirmText: 'Ya, Hitung Skor IRT',
            variant: 'primary',
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const result = await calculateExamIRT(focusExamId);
            await alertDialog(result.success
                ? { title: 'Kalkulasi IRT Selesai', text: `${result.count ?? 0} skor peserta telah diperbarui.${result.warnings?.length ? `\n\nPeringatan:\n${result.warnings.map(warning => `• ${warning}`).join('\n')}` : ''}`, variant: 'success' }
                : { title: 'Gagal Kalkulasi IRT', text: result.error || 'Terjadi kesalahan sistem', variant: 'danger' });
            await load(true);
        } finally {
            setBusy(false);
        }
    };

    const administrationExam = {
        id: roomExams[0]?.exam_id, exam_type: slot.period.type, title: slot.period.name,
        metadata: { pas_period_id: slot.period.id, pas_schedule_id: roomExams[0]?.schedule_id },
    } as unknown as OrganizationExam;
    const hasIrt = String(focusExam?.scoring_type || '').split(',').some(type => type.trim() === 'irt' || type.trim().startsWith('irt_'));
    const resettable = filtered.filter(attempt => canReset(attempt.exam_id));
    const showSearch = !['admin', 'analysis', 'screen'].includes(activeTab);
    const examPicker = (label: string) => roomExams.length > 1 && <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">{label}
        <select value={focusExamId} onChange={event => changeFocusExam(event.target.value)}
            className="max-w-[320px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium">
            {roomExams.map(exam => <option key={exam.exam_id} value={exam.exam_id}>{exam.class_name} · {exam.bank_title}</option>)}
        </select>
    </label>;

    return <section className="space-y-4" aria-label={`Monitoring ${slot.room.name} ${slot.session.name}`}>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    {onBack && <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><ArrowLeft size={13} />Semua ruang</button>}
                    <h2 className="text-base font-bold text-slate-900">{slot.room.name} · {slot.session.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-500"><Clock size={12} className="mr-1 inline" />{formatSlotDate(slot.date)} · {hm(slot.session.start_time)}–{hm(slot.session.end_time)} · {slot.period.name}</p>
                    <p className="mt-1 text-xs text-slate-500"><ShieldCheck size={12} className="mr-1 inline" />Pengawas: {slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : 'belum diatur'}</p>
                </div>
                <button type="button" onClick={() => void load(false)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Perbarui data ruang">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Perbarui
                </button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[['Peserta di ruang', attempts.length || slot.counts.total], ['Mengerjakan', running], ['Selesai', finished], ['Belum masuk', Math.max(0, (attempts.length || slot.counts.total) - running - finished)], ['Perlu perhatian', attention]].map(([label, value], index) =>
                    <div key={label} className={`rounded-lg border px-3 py-2 ${index === 4 && Number(value) > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50/60'}`}>
                        <dt className="text-[11px] text-slate-500">{label}</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{value}</dd></div>)}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Ujian di ruang ini">
                {roomExams.map(exam => <a key={exam.exam_id} href={`${monitoringBasePath}?exam=${encodeURIComponent(exam.exam_id)}`}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700"
                    title="Buka monitoring seluruh peserta ujian ini (semua ruang)">{exam.class_name} · {exam.bank_title} <span className="text-slate-400">({exam.student_count})</span></a>)}
            </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 text-xs font-semibold [&>button]:shrink-0" aria-label="Bagian monitoring ruang">
            {tabs.map(([id, label]) =>
                <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => openTab(id)}
                    className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 ${activeTab === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>)}
        </nav>

        {showSearch && <div className="flex flex-wrap items-center gap-3">
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama, NIS, kelas, atau mapel…" aria-label="Cari peserta"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20" />
            {activeTab === 'live' && <label className="inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} />Hanya yang perlu perhatian</label>}
        </div>}

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}

        {activeTab === 'admin' ? <MonitoringPASAdministrationPanel key={slot.key} exam={administrationExam} attempts={attempts} userRole={userRole} />
            : activeTab === 'analysis' ? <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    {examPicker('Analisis ujian')}
                    <p className="text-[11px] text-slate-500">Mencakup seluruh peserta {focusLabel || 'ujian ini'}, termasuk yang duduk di ruang lain.</p>
                </div>
                {analysisLoading && analysis?.examId !== focusExamId ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat analisis…</div>
                    : analysis?.error ? <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{analysis.error}
                        <button type="button" className="ml-auto font-semibold underline" onClick={() => void loadAnalysis(focusExamId)}>Coba lagi</button></div>
                    : <>
                        <IrtParametersPanel key={`irt-${focusExamId}`} calibration={analysis?.examId === focusExamId ? analysis.irt : null} scoringType={focusExam?.scoring_type} exportTitle={`${slot.period.name} ${focusLabel}`} />
                        <ItemAnalysisPanel key={analysis?.examId || focusExamId} analysis={analysis?.examId === focusExamId ? analysis.items : []} />
                    </>}
            </div>
            : activeTab === 'screen' ? <div className="space-y-4">
                {screenExams.map(exam => <section key={exam.exam_id} aria-label={`Pengecualian layar ${exam.class_name} ${exam.bank_title}`} className="space-y-2">
                    {screenExams.length > 1 && <h3 className="text-xs font-bold text-slate-700">{exam.class_name} · {exam.bank_title}</h3>}
                    <ScreenShareExceptionsPanel examId={exam.exam_id} attempts={attempts.filter(attempt => attempt.exam_id === exam.exam_id)} onChanged={() => void load(true)} />
                </section>)}
            </div>
            : loading && !attempts.length ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat peserta ruang…</div>
            : activeTab === 'live' ? <ActiveParticipantsPanel key={slot.key} attempts={filtered} attentionOnly={attentionOnly}
                onFinish={canFinish ? finish : undefined}
                onViewDetails={viewAnswers} />
            : activeTab === 'answers' ? <MonitoringHealthPanel key={slot.key} attempts={filtered} defaultExpanded
                onRecover={roomExams.some(exam => canReset(exam.exam_id)) ? recover : undefined}
                onViewDetails={viewAnswers} />
            : activeTab === 'results' ? <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {examPicker('Tindakan untuk')}
                    <div className="flex flex-wrap items-center gap-2">
                        {focusExam?.canManage === true && focusExam.canCorrectKeys !== false && focusExamId && <ExamKeyCorrectionButton key={focusExamId} examId={focusExamId} onComplete={() => void load(true)} />}
                        {hasIrt && focusExam?.canManage === true && <Button variant="outline" size="sm" onClick={() => void calculateIrt()} disabled={busy} leftIcon={<Calculator size={14} />}>Kalkulasi IRT</Button>}
                        <Button variant="outline" size="sm" icon="export" onClick={() => void exportResults()} disabled={busy || !focusExamId}>Export</Button>
                    </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <MonitoringResultsTable attempts={filtered.filter(attempt => attempt.status !== 'in_progress')} hasAnyAttempts={attempts.length > 0}
                        onViewDetails={id => viewAnswers?.(id)} onRecover={roomExams.some(exam => canReset(exam.exam_id)) ? recover : undefined} />
                </div>
            </div>
            : activeTab === 'reset' ? (resettable.length || roomExams.some(exam => canReset(exam.exam_id))
                ? <BulkResetPanel key={slot.key} attempts={resettable} examDuration={longestDuration} onRefresh={() => void load(true)} />
                : <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">Reset memerlukan akses admin, proktor, atau pengawas yang ditugaskan pada ujian ini.</p>)
            : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="overflow-x-auto" role="region" aria-label="Daftar peserta ruang" tabIndex={0}><table className="w-full sm:min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 text-xs sm:text-[11px] text-slate-500"><tr>{['Peserta', 'Kelas', 'Bank soal', 'Status', 'Peringatan'].map(label => <th key={label} scope="col" className={`${label === 'Peserta' ? 'p-3 sm:px-4 sm:py-3' : label === 'Status' ? 'p-3 w-[115px] sm:w-auto sm:px-4 sm:py-3' : 'hidden px-4 py-3 sm:table-cell'} font-semibold`}>{label}</th>)}</tr></thead>
                    <tbody>{[...filtered].sort((a, b) => String(a.profiles?.full_name || '').localeCompare(String(b.profiles?.full_name || ''), 'id')).map(attempt => {
                        const done = FINISHED.includes(attempt.status);
                        const active = attempt.status === 'in_progress';
                        return <tr key={`${attempt.exam_id}:${attempt.id}`} onClick={() => setSelectedAttemptKey(`${attempt.exam_id}:${attempt.id}`)} className="border-t border-slate-100 align-top sm:align-middle cursor-pointer transition-colors hover:bg-slate-50 active:bg-slate-100">
                            <td className="p-3 sm:px-4 sm:py-2.5 font-medium text-slate-900">{formatStudentName(attempt.profiles?.full_name, 'Peserta')}<div className="mt-1 sm:mt-0 text-xs sm:text-[10px] font-normal text-slate-500 sm:text-slate-400">{attempt.profiles?.identity_number || '—'} · {attempt.kelas_name || '—'}</div></td>
                            <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{attempt.kelas_name || '—'}</td>
                            <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{roomExams.find(exam => exam.exam_id === attempt.exam_id)?.bank_title || '—'}</td>
                            <td className="p-3 w-[115px] sm:w-auto sm:px-4 sm:py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${done ? 'bg-emerald-50 text-emerald-700' : active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{done ? 'Selesai' : active ? 'Mengerjakan' : 'Belum masuk'}</span><div className="mt-1 font-semibold text-slate-800 sm:hidden">{attempt.saved_answer_count ?? '—'} / {attempt.total_questions ?? '—'} terjawab</div></td>
                            <td className="hidden px-4 py-2.5 tabular-nums text-slate-600 sm:table-cell">{attempt.warning_count || 0}</td>
                        </tr>;
                    })}</tbody>
                </table></div>
                {!filtered.length && <p className="px-4 py-10 text-center text-sm text-slate-500">Tidak ada peserta yang cocok.</p>}
                <AttemptHistoryModal
                    open={Boolean(selectedAttemptKey)}
                    attempt={filtered.find(attempt => `${attempt.exam_id}:${attempt.id}` === selectedAttemptKey) || attempts.find(attempt => `${attempt.exam_id}:${attempt.id}` === selectedAttemptKey) || null}
                    onClose={() => setSelectedAttemptKey(null)}
                    showSessionDetails
                    onViewAnswers={viewAnswers}
                />
            </div>}

        <ResetExamModal
            open={Boolean(resetAttempt) && resetAttempt?.canReset === true}
            attempt={resetAttempt}
            examDuration={resetAttempt ? examDuration(resetAttempt.exam_id) : undefined}
            onClose={() => setResetAttempt(null)}
            onSuccess={() => void load(true)}
        />
    </section>;
}

/**
 * Monitoring ASAS/ASAT/AM per ruang × sesi × tanggal.
 * - Proktor/Admin: papan semua ruang dalam satu folder pada tanggal terpilih.
 * - Pengawas: langsung ke ruang yang sedang ia awasi; ruang tugas lain tetap bisa dipilih.
 */
export default function PASSlotMonitoring({ periodId, userRole, monitoringBasePath, attemptBasePath }: {
    periodId?: string;
    userRole: StaffRole;
    monitoringBasePath: string;
    attemptBasePath?: string;
}) {
    const { timeZone } = useSchoolTimeZone();
    const [dates, setDates] = useState<string[]>([]);
    const [date, setDate] = useState('');
    const [slots, setSlots] = useState<PASMonitoringSlot[]>([]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const autoSelected = useRef(false);
    const request = useRef(0);
    const invigilatorView = userRole === 'pengawas';

    const load = useCallback(async (targetDate: string, silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        setError(null);
        try {
            let result = await listPASMonitoringSlots({ date: targetDate || undefined, periodId });
            const nextDate = targetDate || pickSlotDate(result.available_dates, schoolTodayDate(timeZone));
            if (!targetDate && nextDate) result = await listPASMonitoringSlots({ date: nextDate, periodId });
            if (id !== request.current) return;
            setDates(result.available_dates);
            setDate(nextDate);
            setSlots(result.slots);
            setSelectedKey(previous => {
                if (previous && result.slots.some(slot => slot.key === previous)) return previous;
                if (invigilatorView && !autoSelected.current) {
                    autoSelected.current = true;
                    const nowTime = utcToSchoolLocalDateTime(new Date().toISOString(), timeZone).slice(11, 16);
                    return pickCurrentSlot(result.slots, nowTime)?.key || null;
                }
                return null;
            });
        } catch (loadError) {
            if (id === request.current) setError(loadError instanceof Error ? loadError.message : 'Monitoring ruang belum dapat dimuat.');
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, [periodId, timeZone, invigilatorView]);

    useEffect(() => { void load(''); }, [load]);
    useAutoRefresh(() => { if (date && !selectedKey) void load(date, true); }, REFRESH_INTERVAL.monitoring);

    const selected = slots.find(slot => slot.key === selectedKey) || null;
    const sessions = useMemo(() => {
        const groups = new Map<string, { label: string; slots: PASMonitoringSlot[] }>();
        for (const slot of slots) {
            const key = `${slot.period.id}:${slot.session.id}`;
            if (!groups.has(key)) groups.set(key, { label: `${slot.session.name} · ${hm(slot.session.start_time)}–${hm(slot.session.end_time)}${periodId ? '' : ` · ${slot.period.name}`}`, slots: [] });
            groups.get(key)!.slots.push(slot);
        }
        return [...groups.values()];
    }, [slots, periodId]);

    return <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
                <h2 className="text-sm font-bold text-slate-900">{invigilatorView ? 'Ruang yang Saya Awasi' : 'Pelaksanaan per Ruang'}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{invigilatorView
                    ? 'Semua siswa di ruang Anda tampil dalam satu daftar, apa pun kelas dan bank soalnya.'
                    : 'Pilih tanggal, lalu buka ruang untuk memantau seluruh siswanya sekaligus.'}</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Tanggal
                <select value={date} onChange={event => { setSelectedKey(null); void load(event.target.value); }} disabled={!dates.length || loading}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium">
                    {!dates.length && <option value="">Belum ada jadwal</option>}
                    {dates.map(item => <option key={item} value={item}>{formatSlotDate(item)}</option>)}
                </select>
            </label>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
            <button type="button" className="ml-auto font-semibold underline" onClick={() => void load(date)}>Coba lagi</button></div>}

        {selected ? <RoomMonitor key={selected.key} slot={selected} userRole={userRole} monitoringBasePath={monitoringBasePath}
            attemptBasePath={attemptBasePath} onBack={slots.length > 1 || !invigilatorView ? () => setSelectedKey(null) : undefined} />
            : loading ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat ruang ujian…</div>
            : !slots.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <Users size={28} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">{invigilatorView ? 'Tidak ada ruang yang Anda awasi pada tanggal ini' : 'Belum ada ruang terjadwal pada tanggal ini'}</p>
                <p className="mt-1 text-xs text-slate-500">{invigilatorView ? 'Monitoring ruang hanya terbuka pada hari tugas Anda. Hubungi Proktor bila jadwal hari ini belum muncul.' : 'Pastikan jadwal sudah diaktifkan dan siswa sudah ditempatkan di ruang.'}</p>
            </div>
            : <div className="space-y-5">{sessions.map(group => <section key={group.label} aria-label={group.label}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.slots.map(slot => <SlotCard key={slot.key} slot={slot} active={false} onSelect={() => setSelectedKey(slot.key)} />)}
                </div>
            </section>)}</div>}
    </div>;
}
