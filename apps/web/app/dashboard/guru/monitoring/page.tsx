"use client";
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { calculateExamIRT } from '@/lib/api/grading';
import { getExamAnswersForAnalysisAction,getExamAttemptsAction,getProctorOrganization,getRecentViolationsAction,listOrganizationExams } from '@/lib/api/proctor';
import type { DetailedItemAnalysisResponse,ExamAttemptRecord,OrganizationExam,ViolationEvent } from '@/lib/api/proctor';
import type { QuestionOptionRecord } from '@/lib/api/questions';
import { promptRecoveryDuration,promptRecoveryReason,resetExamAttempt,startMakeupExam } from '@/lib/api/proctoring';
import { getSessionUser } from '@/lib/session';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { getSchoolTimeZone } from '@/lib/school-time';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { REFRESH_INTERVAL } from '@/lib/useAutoRefresh';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import {
Activity,
AlertOctagon,
AlertTriangle,
Calculator,
CheckCircle2,
ChevronDown,
Clock,
Eye,
FileSpreadsheet,Loader2,
Radio,
RefreshCw,
RotateCcw,
ShieldAlert,
TrendingUp,
Users,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useEffect,useState } from 'react';

interface ItemAnalysis {
    id: string;
    number?: number;
    qText: string;
    type: string;
    options: QuestionOptionRecord[];
    total: number;
    correct: number;
    incorrect: number;
    ungraded: number;
    wrongStudents: string[];
    correctStudents: string[];
    incorrectPercentage: number;
}

function MonitoringContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('guru_monitoring_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('guru_monitoring_exams', []);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);

    const [attempts, setAttempts] = useMemoryState<ExamAttemptRecord[]>('guru_monitoring_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<ItemAnalysis[]>('guru_monitoring_analysis', []);
    const [, setDetailedAnalysis] = useMemoryState<DetailedItemAnalysisResponse | null>('guru_monitoring_detailedAnalysis', null);

    const [activeTab, setActiveTab] = useState<'live' | 'results' | 'analysis'>('live');
    const [liveAlerts, setLiveAlerts] = useMemoryState<ViolationEvent[]>('guru_monitoring_liveAlerts', []);
    const [resettingAttemptId, setResettingAttemptId] = useState<string | null>(null);
    const [viewQuestion, setViewQuestion] = useState<ItemAnalysis | null>(null);
    const [viewQuestionFilter, setViewQuestionFilter] = useState<'salah' | 'benar'>('salah');
    const [searchName, setSearchName] = useState('');
    const [filterKelas, setFilterKelas] = useState('');
    const [analysisPage, setAnalysisPage] = useState(1);


    const loadInitialData = useCallback(async () => {
        setIsLoading(true);
        const user = await getSessionUser();
        if (user) {
            const org = await getProctorOrganization();
            console.log('[Monitoring] Org:', org);
            if (org) {
                const examList = await listOrganizationExams();
                console.log('[Monitoring] Exams:', examList);
                setExams(examList);
                if (!initialExamId && examList.length > 0) setSelectedExamId(examList[0].id);
            }
        }
        setIsLoading(false);
    }, [initialExamId, setExams, setIsLoading]);

    const loadExamData = useCallback(async (examId: string, silent = false) => {
        if (!silent) setIsRefreshing(true);
        try {
            const [attData, analysisData] = await Promise.all([
                getExamAttemptsAction(examId),
                getExamAnswersForAnalysisAction(examId)
            ]);
            setAttempts(attData);
            setDetailedAnalysis(analysisData.detailed || null);

            // Nama siswa per attempt utk rincian "siapa yang salah" di Analisis
            const studentByAttempt = new Map<string, string>();
            attData.forEach((att) => studentByAttempt.set(att.id, formatStudentName(att.profiles?.full_name, 'Tanpa Nama')));

            const { questions: bankQuestions, answers: ansRows } = analysisData;
            const itemStats: Record<string, { total: number; correct: number; incorrect: number; ungraded: number; wrongStudents: string[]; correctStudents: string[] }> = {};
            ansRows.forEach((ans) => {
                const qId = ans.question_id;
                if (!itemStats[qId]) itemStats[qId] = { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                itemStats[qId].total += 1;
                // is_correct null = belum ternilai (esai / menunggu penilaian
                // manual) — masuk hitungan "Menjawab" tapi bukan "Salah".
                if (ans.is_correct === true) {
                    itemStats[qId].correct += 1;
                    const nm = studentByAttempt.get(ans.attempt_id ?? '');
                    if (nm) itemStats[qId].correctStudents.push(nm);
                } else if (ans.is_correct === false) {
                    itemStats[qId].incorrect += 1;
                    const nm = studentByAttempt.get(ans.attempt_id ?? '');
                    if (nm) itemStats[qId].wrongStudents.push(nm);
                } else {
                    itemStats[qId].ungraded += 1;
                }
            });

            // SEMUA soal bank ditampilkan (termasuk yang belum dijawab), dengan
            // nomor sesuai urutan bank soal; tetap diurutkan % salah terbesar.
            const analysisArray = bankQuestions.map((q) => {
                const stat = itemStats[q.id] || { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                const graded = stat.correct + stat.incorrect;
                return {
                    id: q.id, number: q.number ?? 0, qText: q.question_text, type: q.type, options: q.options || [],
                    total: stat.total, correct: stat.correct, incorrect: stat.incorrect,
                    ungraded: stat.ungraded,
                    wrongStudents: [...stat.wrongStudents].sort((a, b) => a.localeCompare(b)),
                    correctStudents: [...stat.correctStudents].sort((a, b) => a.localeCompare(b)),
                    incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0
                };
            }).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || (a.number - b.number));
            setAnalysis(analysisArray);
        } catch (error) {
            console.error('[Monitoring] Load error:', error);
        }
        if (!silent) setIsRefreshing(false);
    }, [setAnalysis, setAttempts, setDetailedAnalysis]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadInitialData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadInitialData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAnalysisPage(1);
            if (selectedExamId) void loadExamData(selectedExamId);
            else { setAttempts([]); setAnalysis([]); }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadExamData, selectedExamId, setAnalysis, setAttempts]);

    const handleRefresh = () => { if (selectedExamId) loadExamData(selectedExamId); };

    // Auto-refresh interval
    useEffect(() => {
        if (!selectedExamId) return;
        const interval = setInterval(() => {
            loadExamData(selectedExamId, true);
        }, 15000);
        return () => clearInterval(interval);
    }, [loadExamData, selectedExamId]);

    const handleResetAttempt = async (attemptId: string, studentName: string) => {
        const modeInput = window.prompt(
            `Pilih tindakan untuk ${studentName}:\n\n` +
            `Ketik SUSULAN untuk menghapus jawaban lama dan mengerjakan dari awal.\n` +
            `Ketik PULIHKAN untuk mengirim jawaban tersimpan tanpa mengubah atau mengisi jawaban.`,
            'SUSULAN',
        );
        if (!modeInput) return;
        const mode = modeInput.trim().toUpperCase();
        if (!['SUSULAN', 'PULIHKAN'].includes(mode)) {
            alert('Pilihan harus SUSULAN atau PULIHKAN.');
            return;
        }

        const reason = promptRecoveryReason(studentName);
        if (!reason) return;
        const durationMinutes = promptRecoveryDuration(
            studentName,
            mode === 'SUSULAN' ? 'susulan' : 'pemulihan',
        );
        if (!durationMinutes) return;

        const confirmed = window.confirm(
            mode === 'SUSULAN'
                ? `Aktifkan ujian susulan untuk "${studentName}" selama ${durationMinutes} menit?\n\nSEMUA JAWABAN DAN NILAI LAMA SISWA INI AKAN DIHAPUS. Hasil baru tetap masuk ke rekap ujian yang sama.\n\nAlasan: ${reason}`
                : `Pulihkan ujian "${studentName}" selama ${durationMinutes} menit dengan jawaban server tetap tersimpan?\n\nAlasan: ${reason}`,
        );
        if (!confirmed) return;

        setResettingAttemptId(attemptId);
        try {
            const result = mode === 'SUSULAN'
                ? await startMakeupExam(attemptId, reason, durationMinutes)
                : await resetExamAttempt(attemptId, reason, durationMinutes);
            if (result.success) {
                const deadline = result.recoveryUntil
                    ? ` Tenggat: ${new Date(result.recoveryUntil).toLocaleString('id-ID')}.`
                    : '';
                const detail = mode === 'SUSULAN'
                    ? ` ${'deletedAnswerCount' in result ? result.deletedAnswerCount : 0} jawaban lama dihapus.`
                    : ` ${'serverAnswerCount' in result ? result.serverAnswerCount : 0} jawaban lama dipertahankan.`;
                alert(`${mode === 'SUSULAN' ? 'Ujian susulan' : 'Pemulihan'} untuk "${studentName}" berhasil.${detail}${deadline}`);
                if (selectedExamId) loadExamData(selectedExamId);
            } else {
                alert(`Tindakan gagal: ${result.error}`);
            }
        } catch {
            alert('Terjadi kesalahan saat mengatur ulang ujian.');
        }
        setResettingAttemptId(null);
    };
    const handleCalculateIRT = async () => {
        if (!selectedExamId) return;
        const orgId = exams.find(e => e.id === selectedExamId)?.organization_id;
        if (!orgId) return;

        const confirmed = window.confirm(
            `Kalkulasi Skor IRT akan menghitung ulang nilai semua peserta ujian ini berdasarkan tingkat kesulitan soal yang dijawab.\n\nLanjutkan?`
        );
        if (!confirmed) return;

        setIsRefreshing(true);
        try {
            const res = await calculateExamIRT(selectedExamId);
            if (res.success) {
                const warnings = res.warnings?.length
                    ? `\n\nPeringatan:\n${res.warnings.map((warning) => `• ${warning}`).join('\n')}`
                    : '';
                alert(`Kalkulasi selesai. ${res.count} skor peserta telah diperbarui.${warnings}`);
                loadExamData(selectedExamId);
            } else {
                alert(`Gagal kalkulasi: ${res.error}`);
            }
        } catch {
            alert('Terjadi kesalahan saat kalkulasi IRT');
        }
        setIsRefreshing(false);
    };

    // Umpan pelanggaran dibaca dari log di basis data, bukan dari siaran
    // realtime: sumber siaran (Supabase) sudah tidak ada, dan umpan dari
    // basis data juga tetap terisi setelah halaman dimuat ulang.
    useEffect(() => {
        if (!selectedExamId) return;
        let cancelled = false;

        const load = async () => {
            const events = await getRecentViolationsAction(selectedExamId);
            if (!cancelled) setLiveAlerts(events);
        };

        load();
        const interval = setInterval(load, REFRESH_INTERVAL.monitoring);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [selectedExamId, setLiveAlerts]);

    const totalStudents = attempts.length;
    const inProgress = attempts.filter(a => a.status === 'in_progress').length;
    const completed = attempts.filter(a => a.status === 'submitted' || a.status === 'auto_submitted').length;
    const belumMengerjakan = attempts.filter(a => a.status === 'belum').length;
    // Pelanggaran di kartu statistik = LIVE: hanya milik peserta yang SEDANG
    // mengerjakan (dari warning_count DB, bukan broadcast). Saat tidak ada
    // yang ujian, angka ini 0 — riwayat lengkap tetap ada di Rekap & Detail.
    const totalViolations = attempts
        .filter((a) => a.status === 'in_progress')
        .reduce((sum, a) => sum + (a.warning_count || 0), 0);

    // Filter kelas + pencarian nama, lalu urutkan pelanggaran terbanyak dulu —
    // peserta bermasalah (terminated) yang perlu di-reset naik ke atas.
    const kelasOptions = [...new Set(
        attempts.flatMap((a) => String(a.kelas_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== '-'))
    )].sort();
    const filteredAttempts = attempts
        .filter((a) => !searchName.trim() || (a.profiles?.full_name || '').toLowerCase().includes(searchName.trim().toLowerCase()))
        .filter((a) => !filterKelas || String(a.kelas_name || '').split(',').map((s: string) => s.trim()).includes(filterKelas))
        .sort((a, b) => (b.warning_count ?? 0) - (a.warning_count ?? 0));
    // Pembagian tegas: tab "Aktif" = yang SEDANG mengerjakan (live), tab
    // "Rekap" = yang sudah selesai/terminated (info pelanggaran ada di sana).
    const activeAttempts = filteredAttempts.filter((a) => a.status === 'in_progress');
    const finishedAttempts = filteredAttempts.filter((a) => a.status !== 'in_progress');

    const exportResultsToExcel = async () => {
        try {
            const [freshAttempts, freshAnalysis, timeZone] = await Promise.all([
                getExamAttemptsAction(selectedExamId), getExamAnswersForAnalysisAction(selectedExamId), getSchoolTimeZone(),
            ]);
            if (!freshAttempts.length) throw new Error('Data peserta belum tersedia. Muat ulang monitoring sebelum export.');
            if (freshAttempts.some(a => a.status !== 'belum') && (freshAnalysis.questions.length || freshAttempts.some(a => (a.total_questions || 0) > 0)) && !freshAnalysis.detailed) {
                throw new Error('Analisis rinci belum tersedia. Coba kembali setelah layanan penilaian tersedia.');
            }
            await exportDetailedAnalysisToExcel({
                exam: exams.find(exam => exam.id === selectedExamId), attempts: freshAttempts,
                analysis: [], detailedAnalysis: freshAnalysis.detailed, timeZone,
                questions: freshAnalysis.questions, answers: freshAnalysis.answers,
            });
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Export belum dapat dibuat.');
        }
    };
    if (isLoading) return (
        <div className="flex items-center justify-center min-h-screen">
            <Loader2 size={48} className="text-primary animate-spin" />
        </div>
    );

    const has1PL = attempts.some(a => a.detailed_scores?.irt_1pl !== undefined);
    const has2PL = attempts.some(a => a.detailed_scores?.irt_2pl !== undefined);
    const has3PL = attempts.some(a => a.detailed_scores?.irt_3pl !== undefined);
    // Jumlah kolom tabel Rekap dinamis (9 kolom dasar + kolom IRT yang tampil)
    const rekapColCount = 9 + (has1PL ? 1 : 0) + (has2PL ? 1 : 0) + (has3PL ? 1 : 0) + (!has1PL && !has2PL && !has3PL ? 1 : 0);

    // Tombol Kalkulasi IRT hanya relevan jika sistem penilaian ujian memuat
    // model IRT — kalau tidak, calculateExamIRT memang menolak ("Tidak ada
    // sistem penilaian IRT yang dipilih"), jadi tombolnya disembunyikan.
    const selectedExam = exams.find(e => e.id === selectedExamId);
    const configuredViolationLimit = selectedExam?.metadata?.max_violations;
    const violationLimit = selectedExam?.metadata?.is_safe_mode === false || configuredViolationLimit === null
        ? null
        : (typeof configuredViolationLimit === 'number' && Number.isInteger(configuredViolationLimit) && configuredViolationLimit >= 1
            ? configuredViolationLimit
            : 3);
    const hasIRTScoring = String(selectedExam?.scoring_type || '')
        .split(',')
        .map((t: string) => t.trim())
        .some((t: string) => t === 'irt' || t.startsWith('irt_'));

    // Paginasi tab Analisis — semua soal ditampilkan, 10 per halaman.
    const ANALYSIS_PAGE_SIZE = 10;
    const analysisTotalPages = Math.max(1, Math.ceil(analysis.length / ANALYSIS_PAGE_SIZE));
    const safeAnalysisPage = Math.min(analysisPage, analysisTotalPages);
    const pagedAnalysis = analysis.slice((safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE, safeAnalysisPage * ANALYSIS_PAGE_SIZE);

    return (
        <div className="pb-24 max-w-7xl mx-auto">
            {/* Header — Navy gradient */}
            {/* Stats Cards - Outside Banner */}
            {selectedExamId && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-6">
                    {[
                        { label: 'Total Peserta', value: totalStudents, icon: Users },
                        { label: 'Belum Mengerjakan', value: belumMengerjakan, icon: CheckCircle2 }, // Using CheckCircle2 temporary, I will fix icon below
                        { label: 'Mengerjakan', value: inProgress, icon: Activity, pulse: inProgress > 0 },
                        { label: 'Selesai', value: completed, icon: CheckCircle2 },
                        { label: 'Pelanggaran', value: totalViolations, icon: AlertOctagon, alert: totalViolations > 0 },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                            <div className={`w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center ${
                                stat.alert ? 'bg-red-100 border border-red-200' : 'bg-[#3083FF]/10 border border-[#3083FF]/30'
                            }`}>
                                <stat.icon size={18} className={`${
                                    stat.alert ? 'text-red-500' : stat.pulse ? 'text-emerald-500 animate-pulse' : 'text-[#3083FF]'
                                }`} />
                            </div>
                            <p className="text-2xl font-bold text-[#3083FF]">{stat.value}</p>
                            <p className="text-xs text-slate-500">{stat.label}</p>
                        </div>
                    ))}
                </div>
            )}

            <MonitoringHealthPanel attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onRecover={handleResetAttempt} />

            {/* Control Row: Tabs (if exam selected) & Select Filter/Refresh (always) */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                <div>
                    {selectedExamId ? (
                        <div className="flex gap-1 bg-white border border-[#3083FF]/30 p-1 rounded-lg w-fit shadow-sm">
                            {[
                                { id: 'live', label: 'Aktif', icon: Radio, badge: inProgress > 0 ? inProgress : null },
                                { id: 'results', label: 'Rekap', icon: Users, badge: null as number | null },
                                { id: 'analysis', label: 'Analisis', icon: TrendingUp, badge: null as number | null },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                    className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                                        activeTab === tab.id
                                            ? 'bg-[#3083FF] text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                                    }`}
                                >
                                    <tab.icon size={14} />
                                    {tab.label}
                                    {tab.badge && (
                                        <span className="ml-0.5 w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div />
                    )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Pencarian & filter kelas hanya relevan untuk daftar peserta
                        (Aktif dan Rekap) — tab Pelanggaran berbasis event dan
                        Analisis berbasis butir soal. */}
                    {selectedExamId && (activeTab === 'live' || activeTab === 'results') && (
                        <>
                            <input
                                type="text"
                                value={searchName}
                                onChange={(e) => setSearchName(e.target.value)}
                                placeholder="Cari nama peserta..."
                                className="bg-white border border-[#3083FF]/30 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3083FF]/50 outline-none px-4 py-2.5 rounded-lg text-sm font-medium w-full sm:w-52"
                            />
                            <div className="relative flex-1 sm:flex-none">
                                <select
                                    value={filterKelas}
                                    onChange={(e) => setFilterKelas(e.target.value)}
                                    className="appearance-none bg-white border border-[#3083FF]/30 text-slate-800 focus:ring-2 focus:ring-[#3083FF]/50 outline-none pl-4 pr-10 py-2.5 rounded-lg text-sm font-medium w-full sm:w-auto sm:min-w-[150px] cursor-pointer"
                                >
                                    <option value="">Semua Kelas</option>
                                    {kelasOptions.map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                            </div>
                        </>
                    )}
                    <div className="relative flex-1 sm:flex-none">
                        <select
                            value={selectedExamId}
                            onChange={(e) => setSelectedExamId(e.target.value)}
                            className="appearance-none bg-white border border-[#3083FF]/30 text-slate-800 focus:ring-2 focus:ring-[#3083FF]/50 outline-none pl-4 pr-10 py-2.5 rounded-lg text-sm font-medium w-full sm:w-auto sm:min-w-[220px] cursor-pointer"
                        >
                            <option value="" className="text-slate-500">-- Pilih Ujian --</option>
                            {exams.map(exam => (
                                <option key={exam.id} value={exam.id} className="text-slate-800">{exam.title}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                    <button onClick={handleRefresh} disabled={isRefreshing || !selectedExamId}
                        className="bg-[#3083FF] hover:bg-[#3083FF] text-white px-5 py-2.5 rounded-lg transition-all font-semibold text-sm flex items-center gap-2 disabled:opacity-40 shadow-lg shadow-[#3083FF]/20 cursor-pointer">
                        <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* Empty state */}
            {!selectedExamId && (
                <div className="py-16 text-center bg-white border border-[#3083FF]/30 rounded-lg">
                    <div className="w-16 h-16 bg-[#3083FF]/10 rounded-lg flex items-center justify-center mx-auto mb-4 border border-[#3083FF]/30">
                        <ShieldAlert size={32} className="text-[#3083FF]" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-700 mb-2">Pilih Ujian</h2>
                    <p className="text-sm text-slate-500">Pilih ujian untuk mulai memonitoring</p>
                </div>
            )}

            {selectedExamId && (
                <div className="space-y-4">

                    <AnimatePresence mode="wait">
                        {/* === LIVE TAB === */}
                        {activeTab === 'live' && (
                            <motion.div
                                key="live"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="space-y-4"
                            >
                                {/* Status pemantauan. Datanya disegarkan berkala, bukan
                                    didorong seketika, jadi jedanya disebutkan apa adanya
                                    alih-alih dilabeli "Live". */}
                                <div className="flex items-center gap-3 px-4 py-3 bg-white border border-[#3083FF]/30 rounded-lg shadow-sm">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3083FF] opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#3083FF]"></span>
                                    </span>
                                    <span className="text-xs font-semibold text-[#3083FF] uppercase tracking-wider">
                                        Pantauan otomatis &middot; tiap {REFRESH_INTERVAL.monitoring / 1000} detik
                                    </span>
                                    <div className="ml-auto flex items-center gap-3 text-[10px] font-medium text-slate-500">
                                        <span>{inProgress} aktif</span>
                                        <span className="w-px h-3 bg-slate-200" />
                                        <span>{totalViolations} pelanggaran</span>
                                    </div>
                                </div>

                                {/* Tabel peserta aktif — daftar rapi, pelanggaran pindah ke tab sendiri */}
                                <div className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-[#3083FF]/20 flex items-center justify-between bg-[#3083FF]/5">
                                        <h3 className="font-bold text-[#3083FF]">Sedang Mengerjakan</h3>
                                        <span className="text-[10px] font-semibold text-[#3083FF] uppercase tracking-wider">{inProgress} aktif</span>
                                    </div>

                                    {activeAttempts.length === 0 ? (
                                        <div className="py-16 text-center">
                                            <Users size={36} className="text-slate-200 mx-auto mb-3" />
                                            <p className="text-slate-400 font-medium">
                                                {attempts.length > 0
                                                    ? (inProgress > 0 ? 'Tidak ada peserta aktif yang cocok dengan filter' : 'Tidak ada peserta yang sedang mengerjakan')
                                                    : 'Belum ada peserta'}
                                            </p>
                                            {attempts.length > 0 && inProgress === 0 && (
                                                <p className="text-slate-300 text-xs mt-2">Semua peserta sudah selesai — lihat tab Rekap.</p>
                                            )}
                                            <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-[#3083FF]/10 text-[#3083FF] text-xs font-semibold rounded-lg hover:bg-[#3083FF]/20 transition-all">
                                                <RefreshCw size={12} className="inline mr-1" /> Refresh Data
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                        {/* Mobile (<md): tetap kartu seperti sebelumnya */}
                                        <div className="md:hidden p-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {activeAttempts.map((att) => {
                                                    const liveAlert = liveAlerts.find(a => a.attemptId === att.id);
                                                    const isTerminated = att.status === 'auto_submitted';
                                                    const isInProgress = att.status === 'in_progress';
                                                    const isBelum = att.status === 'belum';
                                                    const canReset = isTerminated || att.status === 'submitted';
                                                    const violations = liveAlert?.violationCount ?? att.warning_count ?? 0;
                                                    const bd = att.violation_breakdown || { pindah_tab: att.tab_switch_count ?? 0, close_tab: 0, lainnya: 0 };
                                                    const MAX = violationLimit ?? Math.max(violations, 1);
                                                    const hasViolations = violations > 0;

                                                    let duration = '-';
                                                    if (att.started_at) {
                                                        const start = new Date(att.started_at);
                                                        const end = att.finished_at ? new Date(att.finished_at) : new Date();
                                                        const diffMins = Math.floor((end.getTime() - start.getTime()) / 60000);
                                                        const hours = Math.floor(diffMins / 60);
                                                        const mins = diffMins % 60;
                                                        duration = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
                                                    }

                                                    return (
                                                        <div
                                                            key={att.id}
                                                            className={`relative rounded-lg border p-4 transition-all overflow-hidden ${
                                                                isTerminated
                                                                    ? 'bg-pink-50/70 border-pink-300'
                                                                    : isInProgress
                                                                    ? hasViolations
                                                                        ? 'bg-red-50/70 border-red-200'
                                                                        : 'bg-[#3083FF]/5 border-[#3083FF]/20'
                                                                    : 'bg-slate-50/70 border-slate-200'
                                                            }`}
                                                        >
                                                            <div className={`absolute top-0 left-0 right-0 h-1 ${
                                                                isTerminated
                                                                    ? 'bg-pink-500'
                                                                    : isInProgress
                                                                    ? hasViolations ? 'bg-red-500' : 'bg-[#3083FF]'
                                                                    : 'bg-slate-300'
                                                            }`} />

                                                            <div className="flex items-start gap-3 mt-1">
                                                                <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                                                                    isTerminated
                                                                        ? 'bg-pink-400'
                                                                        : isInProgress
                                                                        ? hasViolations ? 'bg-red-400' : 'bg-[#3083FF]'
                                                                        : 'bg-slate-400'
                                                                }`}>
                                                                    {att.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-medium text-[#3083FF] text-xs truncate leading-tight">{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</p>
                                                                    {att.kelas_name && att.kelas_name !== '-' && (
                                                                        <p className="text-[9px] text-slate-400 truncate">{att.kelas_name}</p>
                                                                    )}
                                                                    <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
                                                                        isTerminated ? 'text-pink-600' : isInProgress ? 'text-[#3083FF]' : 'text-slate-400'
                                                                    }`}>
                                                                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest ${
                                                                            isTerminated ? 'bg-red-50 text-red-600 border border-red-100'
                                                                            : isInProgress ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                                                            : isBelum ? 'bg-slate-50 text-slate-500 border border-slate-200'
                                                                            : 'bg-blue-50 text-blue-600 border border-blue-100'
                                                                        }`}>
                                                                            {isTerminated ? 'TERMINATED' : isInProgress ? (att.connection_status === 'offline' ? 'KONEKSI TERPUTUS' : 'MENGERJAKAN') : isBelum ? 'BELUM' : 'SELESAI'}
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                                {isInProgress && (
                                                                    <span className="w-2 h-2 bg-[#3083FF] rounded-full animate-pulse mt-2" />
                                                                )}
                                                            </div>

                                                            <div className="mt-3 space-y-2">
                                                                {(isInProgress || isTerminated) && (
                                                                    <div>
                                                                        <div className="flex justify-between text-[9px] font-semibold uppercase tracking-wider mb-1.5">
                                                                            <span className={hasViolations ? 'text-red-500' : 'text-slate-400'}>Pelanggaran</span>
                                                                            <span className={hasViolations ? 'text-red-600' : 'text-slate-400'}>{violations}/{violationLimit ?? '∞'}</span>
                                                                        </div>
                                                                        <div className="flex gap-1">
                                                                            {[...Array(MAX)].map((_, i) => (
                                                                                <div key={i} className={`flex-1 h-1.5 rounded-full transition-all ${
                                                                                    i < violations
                                                                                        ? hasViolations ? 'bg-red-500' : 'bg-[#3083FF]'
                                                                                        : 'bg-slate-100'
                                                                                }`} />
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="flex items-center justify-between gap-1 text-[9px] font-semibold">
                                                                    <span className="text-slate-500">Pindah Tab <span className={bd.pindah_tab > 0 ? 'text-red-600 font-bold' : 'text-[#3083FF]'}>{bd.pindah_tab}x</span></span>
                                                                    <span className="text-slate-500">Close Tab <span className={bd.close_tab > 0 ? 'text-red-600 font-bold' : 'text-[#3083FF]'}>{bd.close_tab}x</span></span>
                                                                    <span className="text-slate-500">Lainnya <span className={bd.lainnya > 0 ? 'text-red-600 font-bold' : 'text-[#3083FF]'}>{bd.lainnya}x</span></span>
                                                                    <span className="text-slate-500 flex items-center gap-1">
                                                                        <Clock size={10} />
                                                                        <span className="text-[#3083FF]">{duration}</span>
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {liveAlert && (
                                                                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[10px] text-amber-800">
                                                                    <span className="font-bold">Pelanggaran terakhir:</span> {liveAlert.violationLabel}
                                                                    <span className="block text-amber-600 mt-0.5">
                                                                        {new Date(liveAlert.timestamp).toLocaleString('id-ID')}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            <div className="mt-3 flex gap-2">
                                                                <button
                                                                    onClick={() => router.push(`/dashboard/guru/monitoring/${att.id}`)}
                                                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#3083FF] hover:bg-[#3083FF]/80 text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all"
                                                                >
                                                                    <Eye size={11} /> Detail
                                                                </button>
                                                                {canReset && (
                                                                    <button
                                                                        onClick={() => handleResetAttempt(att.id, formatStudentName(att.profiles?.full_name, 'Siswa'))}
                                                                        disabled={resettingAttemptId === att.id}
                                                                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#3083FF] text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                                                                    >
                                                                        {resettingAttemptId === att.id ? (
                                                                            <Loader2 size={11} className="animate-spin" />
                                                                        ) : (
                                                                            <RotateCcw size={11} />
                                                                        )}
                                                                        Susulan / Pulihkan
                                                                    </button>
                                                                )}
                                                            </div>

                                                            <div className="mt-2 text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                                                                {att.started_at ? `Mulai ${new Date(att.started_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : '-'}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Desktop (md+): tabel rapi */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full min-w-[980px]">
                                                <thead>
                                                    <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                        <th className="p-3 text-center font-bold text-[#3083FF] w-12">No</th>
                                                        <th className="p-3 text-left font-bold text-[#3083FF]">Nama Peserta</th>
                                                        <th className="p-3 text-left font-bold text-[#3083FF]">Kelas</th>
                                                        <th className="p-3 text-left font-bold text-[#3083FF]">Status</th>
                                                        <th className="p-3 text-center font-bold text-[#3083FF]">Pelanggaran</th>
                                                        <th className="p-3 text-center font-bold text-[#3083FF]">Pindah Tab</th>
                                                        <th className="p-3 text-center font-bold text-[#3083FF]">Close Tab</th>
                                                        <th className="p-3 text-center font-bold text-[#3083FF]">Lainnya</th>
                                                        <th className="p-3 text-left font-bold text-[#3083FF]">Durasi</th>
                                                        <th className="p-3 text-left font-bold text-[#3083FF]">Mulai</th>
                                                        <th className="p-3 text-center font-bold text-[#3083FF]">Aksi</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {activeAttempts.map((att, idx) => {
                                                        const liveAlert = liveAlerts.find(a => a.attemptId === att.id);
                                                        const isInProgress = att.status === 'in_progress';
                                                        const isTerminated = att.status === 'auto_submitted';
                                                        const canReset = isTerminated || att.status === 'submitted';
                                                        const violations = liveAlert?.violationCount ?? att.warning_count ?? 0;
                                                        const bd = att.violation_breakdown || { pindah_tab: att.tab_switch_count ?? 0, close_tab: 0, lainnya: 0 };
                                                        const hasViolations = violations > 0;

                                                        let duration = '-';
                                                        if (att.started_at) {
                                                            const start = new Date(att.started_at);
                                                            const end = att.finished_at ? new Date(att.finished_at) : new Date();
                                                            const diffMins = Math.floor((end.getTime() - start.getTime()) / 60000);
                                                            const hours = Math.floor(diffMins / 60);
                                                            const mins = diffMins % 60;
                                                            duration = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
                                                        }

                                                        return (
                                                            <tr key={att.id} className={`border-b border-[#3083FF]/10 last:border-0 transition-colors ${
                                                                isTerminated ? 'bg-pink-50/40' : hasViolations && isInProgress ? 'bg-red-50/40' : 'hover:bg-[#3083FF]/5'
                                                            }`}>
                                                                <td className="p-3 text-center text-xs font-bold text-slate-400">{idx + 1}</td>
                                                                <td className="p-3">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0 ${
                                                                            isTerminated ? 'bg-pink-400' : isInProgress ? (hasViolations ? 'bg-red-400' : 'bg-[#3083FF]') : 'bg-slate-400'
                                                                        }`}>
                                                                            {att.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                                                                        </div>
                                                                        <span className="font-medium text-[#3083FF] text-xs">{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</span>
                                                                        {isInProgress && <span className="w-2 h-2 bg-[#3083FF] rounded-full animate-pulse shrink-0" />}
                                                                    </div>
                                                                </td>
                                                                <td className="p-3 text-[11px] font-semibold text-slate-500">{att.kelas_name || '-'}</td>
                                                                <td className="p-3">
                                                                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-semibold uppercase tracking-wider border whitespace-nowrap ${
                                                                        isTerminated
                                                                            ? 'bg-pink-100 text-pink-700 border-pink-300'
                                                                            : isInProgress
                                                                            ? 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/30'
                                                                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                    }`}>
                                                                        {isTerminated ? 'Terminated' : isInProgress ? (att.connection_status === 'offline' ? 'Koneksi terputus' : 'Mengerjakan') : 'Selesai'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-center">
                                                                    <span className={`font-bold ${hasViolations ? 'text-red-500' : 'text-slate-400'}`}>
                                                                        {violations}/{violationLimit ?? '∞'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-center text-xs">
                                                                    <span className={bd.pindah_tab > 0 ? 'font-bold text-red-500' : 'text-slate-400'}>{bd.pindah_tab}x</span>
                                                                </td>
                                                                <td className="p-3 text-center text-xs">
                                                                    <span className={bd.close_tab > 0 ? 'font-bold text-red-500' : 'text-slate-400'}>{bd.close_tab}x</span>
                                                                </td>
                                                                <td className="p-3 text-center text-xs">
                                                                    <span className={bd.lainnya > 0 ? 'font-bold text-red-500' : 'text-slate-400'}>{bd.lainnya}x</span>
                                                                </td>
                                                                <td className="p-3 text-[11px] font-semibold text-[#3083FF]">{duration}</td>
                                                                <td className="p-3 text-[11px] font-mono text-slate-500">
                                                                    {att.started_at ? new Date(att.started_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                                                                </td>
                                                                <td className="p-3">
                                                                    <div className="flex items-center justify-center gap-1.5">
                                                                        <button
                                                                            onClick={() => router.push(`/dashboard/guru/monitoring/${att.id}`)}
                                                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3083FF] hover:bg-[#3083FF]/80 text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all"
                                                                        >
                                                                            <Eye size={11} /> Detail
                                                                        </button>
                                                                        {canReset && (
                                                                            <button
                                                                                onClick={() => handleResetAttempt(att.id, formatStudentName(att.profiles?.full_name, 'Siswa'))}
                                                                                disabled={resettingAttemptId === att.id}
                                                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3083FF] text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                                                                            >
                                                                                {resettingAttemptId === att.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                                                                                Susulan / Pulihkan
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        </>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* === REKAP TAB === */}
                        {activeTab === 'results' && (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <div className="px-5 py-4 border-b border-[#3083FF]/20 flex flex-wrap items-center justify-between gap-2 bg-[#3083FF]/5">
                                    <h3 className="font-bold text-[#3083FF]">Rekap Hasil</h3>
                                    <div className="flex gap-2">
                                        {hasIRTScoring && (
                                            <button onClick={handleCalculateIRT} disabled={isRefreshing}
                                                className="flex items-center gap-2 bg-[#3083FF] text-white hover:bg-[#3083FF]/90 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50">
                                                <Calculator size={14} /> Kalkulasi IRT
                                            </button>
                                        )}
                                        <button onClick={exportResultsToExcel}
                                            className="flex items-center gap-2 bg-[#3083FF]/10 text-[#3083FF] hover:bg-[#3083FF]/20 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all border border-[#3083FF]/30">
                                            <FileSpreadsheet size={14} /> Export
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[900px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Nama Peserta</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Kelas</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Status</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Pelanggaran</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Durasi</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Mulai</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Selesai</th>
                                                <th className="p-4 text-right font-bold text-[#3083FF]">Skor Klasik</th>
                                                {has1PL && <th className="p-4 text-right font-bold text-[#3083FF]">IRT 1PL</th>}
                                                {has2PL && <th className="p-4 text-right font-bold text-[#3083FF]">IRT 2PL</th>}
                                                {has3PL && <th className="p-4 text-right font-bold text-[#3083FF]">IRT 3PL</th>}
                                                {!has1PL && !has2PL && !has3PL && <th className="p-4 text-right font-bold text-[#3083FF]">Skor IRT</th>}
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {finishedAttempts.length === 0 ? (
                                                <tr><td colSpan={rekapColCount} className="p-12 text-center text-slate-400 font-medium">
                                                    {attempts.length > 0 ? 'Belum ada peserta yang selesai (atau tidak cocok dengan filter)' : 'Belum ada data'}
                                                </td></tr>
                                            ) : (
                                                finishedAttempts.map((att) => {
                                                    const violationCount = att.warning_count ?? 0;
                                                    const bd = att.violation_breakdown || { pindah_tab: att.tab_switch_count ?? 0, close_tab: 0, lainnya: 0 };
                                                    let duration = '-';
                                                    if (att.started_at) {
                                                        const start = new Date(att.started_at);
                                                        const end = att.finished_at ? new Date(att.finished_at) : new Date();
                                                        const diffMs = end.getTime() - start.getTime();
                                                        const diffMins = Math.floor(diffMs / 60000);
                                                        const hours = Math.floor(diffMins / 60);
                                                        const mins = diffMins % 60;
                                                        duration = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
                                                    }
                                                    const isTerminated = att.status === 'auto_submitted';
                                                    const isBelum = att.status === 'belum';
                                                    const canReset = isTerminated || att.status === 'submitted';
                                                    const statusLabel = isTerminated ? 'Terminated' : att.status === 'submitted' ? 'Selesai' : isBelum ? 'Belum Mengerjakan' : att.connection_status === 'offline' ? 'Koneksi terputus' : 'Mengerjakan';

                                                    return (
                                                        <tr key={att.id}
                                                            className="border-b border-[#3083FF]/10 last:border-0 hover:bg-[#3083FF]/5 transition-colors"
                                                        >
                                                            <td className="p-4 text-xs font-medium text-[#3083FF]">{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</td>
                                                            <td className="p-4 text-[10px] font-semibold text-slate-500">{att.kelas_name || '-'}</td>
                                                            <td className="p-4">
                                                                <span className={`px-3 py-1 rounded-lg text-[9px] font-semibold uppercase tracking-wider border ${
                                                                    isTerminated
                                                                        ? 'bg-pink-100 text-pink-700 border-pink-300'
                                                                        : att.status === 'submitted'
                                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                        : isBelum
                                                                        ? 'bg-slate-50 text-slate-500 border-slate-200'
                                                                        : 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/30'
                                                                }`}>
                                                                    {statusLabel}
                                                                </span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`font-bold ${violationCount > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                                                    {violationCount}x
                                                                </span>
                                                                <span className="block text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">
                                                                    Tab {bd.pindah_tab} · Close {bd.close_tab} · Lain {bd.lainnya}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-[10px] font-semibold text-[#3083FF]">{duration}</td>
                                                            <td className="p-4 text-[10px] font-mono text-slate-500 uppercase">{att.started_at ? new Date(att.started_at).toLocaleString('id-ID') : '-'}</td>
                                                            <td className="p-4 text-[10px] font-mono text-slate-500 uppercase">{att.finished_at ? new Date(att.finished_at).toLocaleString('id-ID') : '-'}</td>
                                                            <td className="p-4 text-right">
                                                                <span className={`font-bold text-xs ${getScoreColorClass(isBelum ? null : (att.detailed_scores?.classical ?? att.total_score ?? 0))}`}>{isBelum ? '-' : Number(att.detailed_scores?.classical ?? att.total_score ?? 0).toFixed(2)}</span>
                                                            </td>
                                                            {has1PL && (
                                                                <td className="p-4 text-right">
                                                                    <span className={`font-bold text-xs ${getScoreColorClass(att.detailed_scores?.irt_1pl)}`}>{att.detailed_scores?.irt_1pl != null ? Number(att.detailed_scores.irt_1pl).toFixed(2) : '-'}</span>
                                                                </td>
                                                            )}
                                                            {has2PL && (
                                                                <td className="p-4 text-right">
                                                                    <span className={`font-bold text-xs ${getScoreColorClass(att.detailed_scores?.irt_2pl)}`}>{att.detailed_scores?.irt_2pl != null ? Number(att.detailed_scores.irt_2pl).toFixed(2) : '-'}</span>
                                                                </td>
                                                            )}
                                                            {has3PL && (
                                                                <td className="p-4 text-right">
                                                                    <span className={`font-bold text-xs ${getScoreColorClass(att.detailed_scores?.irt_3pl)}`}>{att.detailed_scores?.irt_3pl != null ? Number(att.detailed_scores.irt_3pl).toFixed(2) : '-'}</span>
                                                                </td>
                                                            )}
                                                            {!has1PL && !has2PL && !has3PL && (
                                                                <td className="p-4 text-right">
                                                                    <span className={`font-bold text-xs ${getScoreColorClass(att.score_irt)}`}>{att.score_irt != null ? Number(att.score_irt).toFixed(2) : '-'}</span>
                                                                </td>
                                                            )}
                                                            <td className="p-4">
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            if (isBelum) return;
                                                                            e.stopPropagation();
                                                                            router.push(`/dashboard/guru/monitoring/${att.id}`);
                                                                        }}
                                                                        disabled={isBelum}
                                                                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3083FF] hover:bg-[#3083FF]/80 text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        <Eye size={11} /> Detail
                                                                    </button>
                                                                    {canReset && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleResetAttempt(att.id, formatStudentName(att.profiles?.full_name, 'Siswa'));
                                                                            }}
                                                                            disabled={resettingAttemptId === att.id}
                                                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3083FF] text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                                                                        >
                                                                            {resettingAttemptId === att.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                                                                            Susulan / Pulihkan
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {/* === ANALISIS TAB === */}
                        {activeTab === 'analysis' && (
                            <motion.div
                                key="analysis"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <div className="px-5 py-4 border-b border-[#3083FF]/20 flex flex-wrap items-center justify-between gap-2 bg-[#3083FF]/5">
                                    <h3 className="font-bold text-[#3083FF]">Analisis Butir Soal</h3>
                                    <button onClick={exportResultsToExcel}
                                        className="flex items-center gap-2 bg-[#3083FF]/10 text-[#3083FF] hover:bg-[#3083FF]/20 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all border border-[#3083FF]/30">
                                        <FileSpreadsheet size={14} /> Export
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[600px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-14">No</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Soal</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Menjawab</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Benar</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Salah</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Belum Ternilai</th>
                                                <th className="p-4 text-right font-bold text-[#3083FF]">% Salah</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysis.length === 0 ? (
                                                <tr><td colSpan={7} className="p-12 text-center text-slate-400 font-medium">Belum ada data</td></tr>
                                            ) : (
                                                pagedAnalysis.map((anl) => {
                                                    const isCritical = anl.incorrectPercentage > 50;
                                                    return (
                                                        <tr key={anl.id} className={`border-b border-[#3083FF]/10 last:border-0 ${isCritical ? 'bg-red-50/40' : 'hover:bg-slate-50/40'} transition-colors`}>
                                                            <td className="p-4 text-center font-bold text-[#3083FF]">{anl.number}</td>
                                                            <td className="p-4">
                                                                <div className="flex items-start gap-2">
                                                                    {isCritical && <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />}
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className={`relative overflow-hidden max-h-[3.5rem] [mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)] ${isCritical ? 'font-bold text-red-700' : 'font-medium text-slate-600'}`}>
                                                                            <LatexRenderer text={anl.qText} className="!text-[12px] !leading-relaxed" />
                                                                        </div>
                                                                        <button
                                                                            onClick={() => { setViewQuestion(anl); setViewQuestionFilter('salah'); }}
                                                                            className="mt-2 text-xs font-semibold text-[#3083FF] hover:text-[#3083FF] flex items-center gap-1 transition-colors"
                                                                        >
                                                                            <Eye size={12} /> Lihat Soal & Siapa yang Menjawab
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center font-bold text-slate-500">{anl.total}</td>
                                                            <td className="p-4 text-center"><span className="font-bold text-emerald-600">{anl.correct}</span></td>
                                                            <td className="p-4 text-center"><span className="font-bold text-red-500">{anl.incorrect}</span></td>
                                                            <td className="p-4 text-center"><span className="font-bold text-slate-400">{anl.ungraded ?? 0}</span></td>
                                                            <td className="p-4 text-right">
                                                                <div className="flex flex-col items-end">
                                                                    <span className={`font-bold text-lg ${isCritical ? 'text-red-600' : 'text-[#3083FF]'}`}>{anl.incorrectPercentage.toFixed(0)}%</span>
                                                                    <div className="w-20 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                                        <div className={`h-full rounded-full ${isCritical ? 'bg-red-500' : 'bg-[#3083FF]'}`} style={{ width: `${anl.incorrectPercentage}%` }} />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {analysis.length > ANALYSIS_PAGE_SIZE && (
                                    <div className="px-5 py-3 border-t border-[#3083FF]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="text-slate-500 font-semibold">
                                            Menampilkan {(safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE + 1}–{Math.min(safeAnalysisPage * ANALYSIS_PAGE_SIZE, analysis.length)} dari {analysis.length} soal
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setAnalysisPage(p => Math.max(1, p - 1))}
                                                disabled={safeAnalysisPage <= 1}
                                                className="px-3 py-1.5 rounded-lg border border-[#3083FF]/30 text-[#3083FF] font-semibold disabled:opacity-40 hover:bg-[#3083FF]/5 transition-all"
                                            >
                                                Sebelumnya
                                            </button>
                                            <span className="font-bold text-[#3083FF]">{safeAnalysisPage}/{analysisTotalPages}</span>
                                            <button
                                                onClick={() => setAnalysisPage(p => Math.min(analysisTotalPages, p + 1))}
                                                disabled={safeAnalysisPage >= analysisTotalPages}
                                                className="px-3 py-1.5 rounded-lg border border-[#3083FF]/30 text-[#3083FF] font-semibold disabled:opacity-40 hover:bg-[#3083FF]/5 transition-all"
                                            >
                                                Berikutnya
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {analysis.length > 0 && (
                                    <div className="px-5 py-3 bg-[#3083FF]/10 border-t border-[#3083FF]/20 text-[10px] text-[#3083FF] font-semibold uppercase tracking-wider flex items-center gap-2">
                                        <AlertTriangle size={11} /> Baris merah menunjukkan soal dengan persentase kesalahan &gt; 50%
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
            {/* VIEW QUESTION MODAL */}
            <AnimatePresence>
                {viewQuestion && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
                        onClick={() => setViewQuestion(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85dvh]"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                <h3 className="font-bold text-slate-800">Detail Soal{viewQuestion.number ? ` No. ${viewQuestion.number}` : ''}</h3>
                                <button onClick={() => setViewQuestion(null)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-200 rounded-lg transition-colors">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1">
                                <LatexRenderer text={viewQuestion.qText} className="text-base text-slate-700 leading-relaxed" />

                                {/* Opsi jawaban terurut; kunci ditandai hijau */}
                                {(viewQuestion.options?.length ?? 0) > 0 && (
                                    <div className="mt-4 space-y-1.5">
                                        {viewQuestion.options.map((opt, i) => (
                                            <div key={opt.id || i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${
                                                opt.is_correct ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'
                                            }`}>
                                                <span className={`font-bold shrink-0 ${opt.is_correct ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                    {String.fromCharCode(65 + i)}.
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <LatexRenderer text={opt.option_text || ''} className="!text-[13px] !leading-relaxed" />
                                                </div>
                                                {opt.is_correct && <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
                                    <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg border border-slate-200">Menjawab {viewQuestion.total}</span>
                                    <button onClick={() => setViewQuestionFilter('benar')} className={`px-2.5 py-1 rounded-lg border transition-colors ${viewQuestionFilter === 'benar' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 ring-2 ring-emerald-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>Benar {viewQuestion.correct}</button>
                                    <button onClick={() => setViewQuestionFilter('salah')} className={`px-2.5 py-1 rounded-lg border transition-colors ${viewQuestionFilter === 'salah' ? 'bg-red-100 text-red-800 border-red-300 ring-2 ring-red-200' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>Salah {viewQuestion.incorrect}</button>
                                    {(viewQuestion.ungraded ?? 0) > 0 && (
                                        <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">Belum Ternilai {viewQuestion.ungraded}</span>
                                    )}
                                </div>
                                {viewQuestionFilter === 'salah' && (viewQuestion.wrongStudents?.length ?? 0) > 0 && (
                                    <div className="mt-5">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1.5">
                                            <AlertTriangle size={12} /> Siswa yang Menjawab Salah ({viewQuestion.wrongStudents.length})
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                            {viewQuestion.wrongStudents.map((nm: string, i: number) => (
                                                <div key={i} className="flex items-baseline gap-2 text-xs text-slate-700 py-1.5 border-b border-slate-100">
                                                    <span className="w-6 shrink-0 text-right font-bold text-slate-400">{i + 1}.</span>
                                                    <span className="font-medium">{nm}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {viewQuestionFilter === 'benar' && (viewQuestion.correctStudents?.length ?? 0) > 0 && (
                                    <div className="mt-5">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2 flex items-center gap-1.5">
                                            <CheckCircle2 size={12} /> Siswa yang Menjawab Benar ({viewQuestion.correctStudents.length})
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                            {viewQuestion.correctStudents.map((nm: string, i: number) => (
                                                <div key={i} className="flex items-baseline gap-2 text-xs text-slate-700 py-1.5 border-b border-slate-100">
                                                    <span className="w-6 shrink-0 text-right font-bold text-slate-400">{i + 1}.</span>
                                                    <span className="font-medium">{nm}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                                <button onClick={() => setViewQuestion(null)} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
                                    Tutup
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function MonitoringPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 size={48} className="text-primary animate-spin" /></div>}>
            <MonitoringContent />
        </Suspense>
    );
}
