"use client";
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { isMonitoringExamActive, monitoringExamLabel, sortMonitoringExams } from '@/lib/monitoring-exams';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { ResetExamModal } from '@/app/components/monitoring';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { Button } from '@/app/components/ui/button';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { calculateExamIRT } from '@/lib/api/grading';
import { getExamAnswersForAnalysisAction,getExamAttemptsAction,getProctorOrganization,listOrganizationExams } from '@/lib/api/proctor';
import type { DetailedItemAnalysisResponse,ExamAttemptRecord,OrganizationExam } from '@/lib/api/proctor';
import type { QuestionOptionRecord } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { getSchoolTimeZone } from '@/lib/school-time';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import {
Activity,
AlertOctagon,
AlertTriangle,
Calculator,
CheckCircle2,
ChevronDown,
Eye,
Loader2,
Radio,
RefreshCw,
ShieldAlert,
TrendingUp,
Users,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useEffect,useRef,useState } from 'react';

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
    const monitoringNow = useMonitoringExamClock();
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
    const [loadError, setLoadError] = useState<string | null>(null);
    const examRequestGenerationRef = useRef(0);
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
                const examList = sortMonitoringExams(await listOrganizationExams());
                console.log('[Monitoring] Exams:', examList);
                setExams(examList);
                if (!initialExamId && examList.length > 0) setSelectedExamId(examList[0].id);
            }
        }
        setIsLoading(false);
    }, [initialExamId, setExams, setIsLoading]);

    const loadingExamIdsRef = useRef(new Map<string, number>());
    const lastRequestedExamIdRef = useRef('');
    const loadExamData = useCallback(async (examId: string, silent = false) => {
        if (silent && loadingExamIdsRef.current.has(examId)) return;
        const generation = ++examRequestGenerationRef.current;
        loadingExamIdsRef.current.set(examId, generation);
        if (lastRequestedExamIdRef.current !== examId) {
            lastRequestedExamIdRef.current = examId;
            setAttempts([]); setAnalysis([]); setLoadError(null);
            setSearchName(''); setFilterKelas('');
        }
        if (!silent) setIsRefreshing(true);
        try {
            const [attData, analysisData] = await Promise.all([
                getExamAttemptsAction(examId).then(rows => {
                    if (generation !== examRequestGenerationRef.current) return rows;
                    setAttempts(rows);
                    setLoadError(null);
                    return rows;
                }),
                activeTab === 'analysis' ? getExamAnswersForAnalysisAction(examId) : Promise.resolve({ questions: [], answers: [], detailed: null })
            ]);
            if (generation !== examRequestGenerationRef.current) return;
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
            if (generation !== examRequestGenerationRef.current) return;
            setAnalysis(analysisArray);
        } catch (error) {
            console.error('[Monitoring] Load error:', error);
            if (generation === examRequestGenerationRef.current) setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
        } finally {
            if (loadingExamIdsRef.current.get(examId) === generation) loadingExamIdsRef.current.delete(examId);
            if (!silent && generation === examRequestGenerationRef.current) setIsRefreshing(false);
        }
    }, [activeTab, setAnalysis, setAttempts, setDetailedAnalysis]);

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

    const canManage = exams.find(exam => exam.id === selectedExamId)?.canManage === true;

    const [selectedResetAttempt, setSelectedResetAttempt] = useState<ExamAttemptRecord | null>(null);

    const canResetParticipants = exams.find(exam => exam.id === selectedExamId)?.canResetParticipants === true;

    const handleResetAttempt = (attempt: ExamAttemptRecord) => {
        if (!canResetParticipants || attempt.exam_id !== selectedExamId) return;
        if (!canManage || attempt.exam_id !== selectedExamId) return;
        setSelectedResetAttempt(attempt);
    };
    const handleCalculateIRT = async () => {
        if (!selectedExamId || !canManage) return;
        const orgId = exams.find(e => e.id === selectedExamId)?.organization_id;
        if (!orgId) return;

        const confirmed = await confirmDialog({
            title: 'Kalkulasi Skor IRT?',
            text: 'Kalkulasi Skor IRT akan menghitung ulang nilai semua peserta ujian ini berdasarkan tingkat kesulitan butir soal yang dijawab.',
            confirmText: 'Ya, Hitung Skor IRT',
            variant: 'primary',
        });
        if (!confirmed) return;

        setIsRefreshing(true);
        try {
            const res = await calculateExamIRT(selectedExamId);
            if (res.success) {
                const warnings = res.warnings?.length
                    ? `\n\nPeringatan:\n${res.warnings.map((warning) => `• ${warning}`).join('\n')}`
                    : '';
                await alertDialog({
                    title: 'Kalkulasi IRT Selesai',
                    text: `Kalkulasi selesai. ${res.count ?? 0} skor peserta telah diperbarui.${warnings}`,
                    variant: 'success',
                });
                loadExamData(selectedExamId);
            } else {
                await alertDialog({
                    title: 'Gagal Kalkulasi IRT',
                    text: res.error || 'Terjadi kesalahan sistem',
                    variant: 'danger',
                });
            }
        } catch {
            await alertDialog({
                title: 'Kesalahan Sistem',
                text: 'Terjadi kesalahan saat kalkulasi IRT',
                variant: 'danger',
            });
        }
        setIsRefreshing(false);
    };



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
    // Jumlah kolom tabel Rekap dinamis (7 kolom dasar + kolom IRT yang tampil)
    const rekapColCount = 8 + (has1PL ? 1 : 0) + (has2PL ? 1 : 0) + (has3PL ? 1 : 0) + (!has1PL && !has2PL && !has3PL ? 1 : 0);

    // Tombol Kalkulasi IRT hanya relevan jika sistem penilaian ujian memuat
    // model IRT — kalau tidak, calculateExamIRT memang menolak ("Tidak ada
    // sistem penilaian IRT yang dipilih"), jadi tombolnya disembunyikan.
    const selectedExam = exams.find(e => e.id === selectedExamId);
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4 sm:mb-6">
                    {[
                        { label: 'Total Peserta', value: totalStudents, icon: Users },
                        { label: 'Belum Mengerjakan', value: belumMengerjakan, icon: CheckCircle2 }, // Using CheckCircle2 temporary, I will fix icon below
                        { label: 'Mengerjakan', value: inProgress, icon: Activity, pulse: inProgress > 0 },
                        { label: 'Selesai', value: completed, icon: CheckCircle2 },
                        { label: 'Peringatan tercatat', value: totalViolations, icon: AlertOctagon, alert: totalViolations > 0 },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white rounded-xl border border-slate-200 text-center px-3 py-2.5 sm:px-4 sm:py-3 shadow-sm">
                            <div className={`w-8 h-8 sm:w-10 sm:h-10 mx-auto mb-1.5 sm:mb-2 rounded-lg flex items-center justify-center ${
                                stat.alert ? 'bg-red-100 border border-red-200' : 'bg-[#3083FF]/10 border border-[#3083FF]/30'
                            }`}>
                                <stat.icon size={18} className={`${
                                    stat.alert ? 'text-red-500' : stat.pulse ? 'text-emerald-500 animate-pulse' : 'text-[#3083FF]'
                                }`} />
                            </div>
                            <p className="text-xl sm:text-2xl font-bold text-[#3083FF]">{stat.value}</p>
                            <p className="text-[11px] sm:text-xs text-slate-500">{stat.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {selectedExamId && loadError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <p className="font-semibold">Peserta monitoring gagal dimuat</p>
                    <p className="mt-1">{loadError}</p>
                    <button type="button" onClick={handleRefresh} className="mt-2 font-semibold underline">Coba lagi</button>
                </div>
            )}
            <MonitoringHealthPanel key={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onRecover={canResetParticipants ? handleResetAttempt : undefined} />

            {selectedExamId && !canManage && <p className="mb-4 text-sm text-slate-600">Mode lihat saja. Anda dapat memantau dan mengekspor hasil ujian ini.</p>}

            {/* Control Row: Tabs (if exam selected) & Select Filter/Refresh (always) */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4 sm:mb-6">
                <div>
                    {selectedExamId ? (
                        <div className="flex max-w-full gap-1 overflow-x-auto bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
                            {[
                                { id: 'live', label: 'Aktif', icon: Radio, badge: inProgress > 0 ? inProgress : null },
                                { id: 'results', label: 'Rekap', icon: Users, badge: null as number | null },
                                { id: 'analysis', label: 'Analisis', icon: TrendingUp, badge: null as number | null },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                    className={`relative flex shrink-0 items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
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
                    <div className="relative flex-1 min-w-0 sm:flex-none sm:min-w-[280px]">
                        <SearchableSelect
                            className="w-full"
                            placeholder="Cari atau pilih ujian..."
                                searchPlaceholder="Ketik nama ujian..."
                            options={sortMonitoringExams(exams, monitoringNow).map(exam => ({
                                value: exam.id,
                                    statusDot: isMonitoringExamActive(exam, monitoringNow) ? 'Ujian aktif' : undefined,
                                label: monitoringExamLabel(exam),
                            }))}
                            value={selectedExamId}
                            onChange={(val) => setSelectedExamId(String(val || ''))}
                        />
                    </div>
                    <button onClick={handleRefresh} disabled={isRefreshing || !selectedExamId}
                        className="bg-[#3083FF] hover:bg-[#3083FF] text-white px-5 py-2.5 rounded-lg transition-all font-semibold text-sm flex items-center gap-2 disabled:opacity-40 shadow-lg shadow-[#3083FF]/20 cursor-pointer">
                        <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} /> Refresh
                    </button>
                    {selectedExamId && activeTab === 'results' && (
                        <>
                            {selectedExam?.canManage === true && selectedExam.canCorrectKeys !== false && <ExamKeyCorrectionButton key={selectedExamId} examId={selectedExamId} onComplete={handleRefresh} />}
                            {canManage && hasIRTScoring && (
                                <Button
                                    variant="outline"
                                    onClick={handleCalculateIRT}
                                    disabled={isRefreshing}
                                    leftIcon={<Calculator size={14} />}
                                >
                                    Kalkulasi IRT
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                icon="export"
                                onClick={exportResultsToExcel}
                            >
                                Export
                            </Button>
                        </>
                    )}
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
                        {activeTab === 'live' && <ActiveParticipantsPanel key={selectedExamId} attempts={activeAttempts} onViewDetails={id => router.push('/dashboard/guru/monitoring/' + id)} />}

                        {/* === REKAP TAB === */}
                        {activeTab === 'results' && (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[900px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="w-12 p-4 text-left font-bold text-[#3083FF]">No.</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Peserta</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Status</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Pelanggaran</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Durasi</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Mulai / Selesai</th>
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
                                                finishedAttempts.map((att, index) => {
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
                                                    const statusLabel = isTerminated ? 'Terminated' : att.status === 'submitted' ? 'Selesai' : isBelum ? 'Belum Mengerjakan' : att.connection_status === 'offline' ? 'Koneksi terputus' : 'Mengerjakan';

                                                    return (
                                                        <tr key={att.id}
                                                            className="border-b border-[#3083FF]/10 last:border-0 hover:bg-[#3083FF]/5 transition-colors"
                                                        >
                                                            <td className="p-4 text-xs text-slate-500 tabular-nums">{index + 1}</td>
                                                            <td className="p-4">
                                                                <div className="text-xs font-medium text-[#3083FF] leading-tight">
                                                                    {formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}
                                                                </div>
                                                                <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
                                                                    {att.kelas_name || '-'}
                                                                </div>
                                                            </td>
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
                                                            <td className="p-4 whitespace-nowrap">
                                                                <div className="text-[10px] font-mono text-slate-600">
                                                                    {att.started_at ? new Date(att.started_at).toLocaleString('id-ID') : '-'}
                                                                </div>
                                                                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                                                    {att.finished_at ? new Date(att.finished_at).toLocaleString('id-ID') : '-'}
                                                                </div>
                                                            </td>
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
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[600px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
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
                                                            <td className="p-4 text-center font-bold text-[#3083FF] text-[11px]">{anl.number}</td>
                                                            <td className="p-4">
                                                                <div className="min-w-0">
                                                                    <div className={`relative overflow-hidden max-h-[3.5rem] [mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)] ${isCritical ? 'font-bold text-red-700' : 'font-medium text-slate-600'}`}>
                                                                        <LatexRenderer text={anl.qText} className="!text-[12px] !leading-relaxed" />
                                                                    </div>
                                                                    <button
                                                                        onClick={() => { setViewQuestion(anl); setViewQuestionFilter('salah'); }}
                                                                        className="mt-2 text-[11px] font-semibold text-[#3083FF] hover:text-[#2563EB] transition-colors"
                                                                    >
                                                                        Detail Jawaban
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center font-bold text-slate-500 text-[11px]">{anl.total}</td>
                                                            <td className="p-4 text-center"><span className="font-bold text-emerald-600 text-[11px]">{anl.correct}</span></td>
                                                            <td className="p-4 text-center"><span className="font-bold text-red-500 text-[11px]">{anl.incorrect}</span></td>
                                                            <td className="p-4 text-center"><span className="font-bold text-slate-400 text-[11px]">{anl.ungraded ?? 0}</span></td>
                                                            <td className="p-4 text-right">
                                                                <div className="flex flex-col items-end">
                                                                    <span className={`font-bold text-[11px] ${isCritical ? 'text-red-600' : 'text-[#3083FF]'}`}>{anl.incorrectPercentage.toFixed(0)}%</span>
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

            <ResetExamModal
                open={canResetParticipants && selectedResetAttempt?.exam_id === selectedExamId}
                attempt={selectedResetAttempt}
                examDuration={
                    exams.find(e => e.id === (selectedResetAttempt?.exam_id || selectedExamId))?.duration_minutes ??
                    selectedExam?.duration_minutes ??
                    selectedExam?.duration
                }
                onClose={() => setSelectedResetAttempt(null)}
                onSuccess={() => {
                    if (selectedExamId) loadExamData(selectedExamId);
                }}
            />
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
