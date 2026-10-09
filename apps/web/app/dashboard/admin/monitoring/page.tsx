"use client";
import { monitoringExamLabel, sortMonitoringExams } from '@/lib/monitoring-exams';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { ResetExamModal } from '@/app/components/monitoring';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { FilterSearch, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { calculateExamIRT } from '@/lib/api/grading';
import { getExamAnswersForAnalysisAction,getExamAttemptsAction,getExamAttemptsResult,getProctorOrganization,getRecentViolationsAction,listOrganizationExams } from '@/lib/api/proctor';
import type {
    ExamAttemptRecord,
    OrganizationExam,
    ViolationEvent,
    DetailedItemAnalysisResponse,
    StudentAnswerSummary,
    ItemAnalysis,
} from '@/lib/api/proctor';
import { promptRecoveryDuration,promptRecoveryReason,resetExamAttempt,startMakeupExam } from '@/lib/api/proctoring';
import { getSessionUser } from '@/lib/session';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { REFRESH_INTERVAL } from '@/lib/useAutoRefresh';
import { useMemoryState } from '@/lib/useMemoryState';
import { getSchoolTimeZone } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { useToast } from '@/app/components/ui/Toast';
import { AnimatePresence,motion } from 'framer-motion';
import {
Activity,
AlertOctagon,
AlertTriangle,
Calculator,
CheckCircle2,
Clock,
Eye,
FileSpreadsheet,Loader2,
Radio,
RefreshCw,
RotateCcw,
ShieldAlert,
TrendingUp,
UserCheck,
UserX,
Users,
PieChart,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useDeferredValue,useEffect,useRef,useState } from 'react';

export type { ItemAnalysis };

function MonitoringContent() {
    const { timeZone } = useSchoolTimeZone();
    const monitoringNow = useMonitoringExamClock();
    const searchParams = useSearchParams();
    const router = useRouter();
    const toast = useToast();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('proktor_monitoring_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('proktor_monitoring_exams', []);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);

    const [attempts, setAttempts] = useMemoryState<ExamAttemptRecord[]>('proktor_monitoring_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<ItemAnalysis[]>('proktor_monitoring_analysis', []);
    const [, setDetailedAnalysis] = useMemoryState<DetailedItemAnalysisResponse | null>('admin_monitoring_detailedAnalysis', null);
    const [modalActiveTab, setModalActiveTab] = useState<'soal' | 'benar' | 'salah' | 'distraktor'>('soal');

    const [activeTab, setActiveTab] = useState<'live' | 'answers' | 'results' | 'analysis'>('live');
    const [liveAlerts, setLiveAlerts] = useMemoryState<ViolationEvent[]>('proktor_monitoring_liveAlerts', []);
    const [resettingAttemptId, setResettingAttemptId] = useState<string | null>(null);
    const [viewQuestion, setViewQuestion] = useState<ItemAnalysis | null>(null);
    const [searchName, setSearchName] = useState('');
    const [filterKelas, setFilterKelas] = useState<string[]>([]);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [analysisPage, setAnalysisPage] = useState(1);
    const [loadError, setLoadError] = useState<string | null>(null);
    const examRequestGenerationRef = useRef(0);
    const lastRequestedExamIdRef = useRef<string | null>(null);


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

    const loadExamData = useCallback(async (examId: string, silent = false) => {
        const generation = ++examRequestGenerationRef.current;
        if (lastRequestedExamIdRef.current !== examId) {
            lastRequestedExamIdRef.current = examId;
            setAttempts([]);
            setAnalysis([]);
            setDetailedAnalysis(null);
            setLoadError(null);
        }
        if (!silent) setIsRefreshing(true);
        try {
            const [attemptsResult, analysisData] = await Promise.all([
                getExamAttemptsResult(examId),
                getExamAnswersForAnalysisAction(examId)
            ]);
            if (generation !== examRequestGenerationRef.current) return;
            if (!attemptsResult.success) {
                setLoadError(attemptsResult.error);
                return;
            }
            const attData = attemptsResult.attempts;
            setAttempts(attData);
            setDetailedAnalysis(analysisData.detailed || null);

            if (analysisData.detailed?.items?.length) {
                const analysisArray: ItemAnalysis[] = analysisData.detailed.items.map((item) => ({
                    id: item.id,
                    number: item.number,
                    qText: item.question_text,
                    type: item.type,
                    options: item.options || [],
                    total: item.total_answered,
                    correct: item.total_correct,
                    incorrect: item.total_incorrect,
                    ungraded: item.total_ungraded,
                    unanswered: item.total_unanswered,
                    keyDisplay: item.key_display,
                    difficultyIndex: item.difficulty_index,
                    difficultyLabel: item.difficulty_label,
                    discriminationIndex: item.discrimination_index,
                    discriminationLabel: item.discrimination_label,
                    wrongStudents: item.wrong_students || [],
                    correctStudents: item.correct_students || [],
                    ungradedStudents: item.ungraded_students || [],
                    unansweredStudents: item.unanswered_students || [],
                    distractorDistribution: item.distractor_distribution || [],
                    incorrectPercentage: item.incorrect_percentage,
                })).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || ((a.number || 0) - (b.number || 0)));

                setAnalysis(analysisArray);
            } else {
                // Fallback jika layanan Python belum mengembalikan detailed
                const studentByAttempt = new Map<string, { name: string; class: string; nis: string }>();
                attData.forEach((att) => {
                    studentByAttempt.set(att.id, {
                        name: formatStudentName(att.profiles?.full_name, 'Tanpa Nama'),
                        class: att.kelas_name || '-',
                        nis: att.profiles?.identity_number || '-',
                    });
                });

                const { questions: bankQuestions, answers: ansRows } = analysisData;
                const itemStats: Record<string, {
                    total: number;
                    correct: number;
                    incorrect: number;
                    ungraded: number;
                    wrongStudents: StudentAnswerSummary[];
                    correctStudents: StudentAnswerSummary[];
                }> = {};

                ansRows.forEach((ans) => {
                    const qId = ans.question_id;
                    if (!itemStats[qId]) itemStats[qId] = { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                    itemStats[qId].total += 1;
                    const stu = studentByAttempt.get(ans.attempt_id ?? '') || { name: 'Tanpa Nama', class: '-', nis: '-' };
                    const summary: StudentAnswerSummary = {
                        attempt_id: ans.attempt_id ?? '',
                        student_name: stu.name,
                        class_name: stu.class,
                        student_nis: stu.nis,
                        score: ans.score != null ? Number(ans.score) : (ans.is_correct ? 1 : 0),
                        display_answer: ans.selected_option_id || (typeof ans.essay_answer === 'string' ? ans.essay_answer : '-'),
                        is_correct: ans.is_correct ?? null,
                    };

                    if (ans.is_correct === true) {
                        itemStats[qId].correct += 1;
                        itemStats[qId].correctStudents.push(summary);
                    } else if (ans.is_correct === false) {
                        itemStats[qId].incorrect += 1;
                        itemStats[qId].wrongStudents.push(summary);
                    } else {
                        itemStats[qId].ungraded += 1;
                    }
                });

                const analysisArray: ItemAnalysis[] = bankQuestions.map((q) => {
                    const stat = itemStats[q.id] || { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                    const graded = stat.correct + stat.incorrect;
                    return {
                        id: q.id,
                        number: q.number ?? 0,
                        qText: q.question_text,
                        type: q.type,
                        options: q.options || [],
                        total: stat.total,
                        correct: stat.correct,
                        incorrect: stat.incorrect,
                        ungraded: stat.ungraded,
                        wrongStudents: [...stat.wrongStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
                        correctStudents: [...stat.correctStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
                        incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0
                    };
                }).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || ((a.number || 0) - (b.number || 0)));

                setAnalysis(analysisArray);
            }
            setLoadError(null);
        } catch (error) {
            console.error('[Monitoring] Load error:', error);
            if (generation === examRequestGenerationRef.current) {
                setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
            }
        } finally {
            if (!silent) setIsRefreshing(false);
        }
    }, [setAnalysis, setAttempts, setDetailedAnalysis]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadInitialData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadInitialData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAnalysisPage(1);
            if (selectedExamId) void loadExamData(selectedExamId);
            else {
                examRequestGenerationRef.current += 1;
                lastRequestedExamIdRef.current = null;
                setAttempts([]);
                setAnalysis([]);
                setDetailedAnalysis(null);
                setLoadError(null);
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadExamData, selectedExamId, setAnalysis, setAttempts, setDetailedAnalysis]);

    const handleRefresh = () => { if (selectedExamId) loadExamData(selectedExamId); };

    // Auto-refresh interval
    useEffect(() => {
        if (!selectedExamId) return;
        const interval = setInterval(() => {
            loadExamData(selectedExamId, true);
        }, 15000);
        return () => clearInterval(interval);
    }, [loadExamData, selectedExamId]);

    const [selectedResetAttempt, setSelectedResetAttempt] = useState<ExamAttemptRecord | null>(null);

    const handleResetAttempt = (attempt: ExamAttemptRecord) => {
        setSelectedResetAttempt(attempt);
    };
    const handleCalculateIRT = async () => {
        if (!selectedExamId) return;
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

    // Filter kelas + pencarian nama, lalu urutkan pelanggaran terbanyak dulu —
    // peserta bermasalah (terminated) yang perlu di-reset naik ke atas.
    const kelasOptions = [...new Set(
        attempts.flatMap((a) => String(a.kelas_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== '-'))
    )].sort();
    const deferredSearchName = useDeferredValue(searchName);
    const filteredAttempts = attempts
        .filter((a) => !deferredSearchName.trim() || (a.profiles?.full_name || '').toLowerCase().includes(deferredSearchName.trim().toLowerCase()))
        .filter((a) => {
            if (!filterKelas || filterKelas.length === 0) return true;
            const studentClasses = String(a.kelas_name || '').split(',').map((s: string) => s.trim());
            return filterKelas.some((k: string) => studentClasses.includes(k));
        })
        .filter((a) => {
            if (filterStatus === 'all') return true;
            if (filterStatus === 'in_progress') return a.status === 'in_progress';
            if (filterStatus === 'submitted') return a.status === 'submitted';
            if (filterStatus === 'auto_submitted') return a.status === 'auto_submitted';
            if (filterStatus === 'belum') return a.status === 'belum';
            return true;
        })
        .sort((a, b) => (b.warning_count ?? 0) - (a.warning_count ?? 0));

    const totalStudents = attempts.length;
    const inProgress = attempts.filter(a => a.status === 'in_progress').length;
    const completed = attempts.filter(a => a.status === 'submitted' || a.status === 'auto_submitted').length;
    const belumMengerjakan = attempts.filter(a => a.status === 'belum').length;
    // Pelanggaran di kartu statistik = LIVE: hanya milik peserta yang SEDANG
    // mengerjakan (dari warning_count DB, bukan broadcast). Saat tidak ada
    // yang ujian, angka ini 0 — riwayat lengkap tetap ada di Rekap & Detail.
    const totalViolations = filteredAttempts
        .filter((a) => a.status === 'in_progress')
        .reduce((sum, a) => sum + (a.warning_count || 0), 0);

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
            <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    {selectedExamId && (
                        <div className="flex w-fit shrink-0 gap-1 rounded-lg border border-[#3083FF]/20 bg-slate-50 p-1">
                            {[
                                { id: 'live', label: 'Peserta Aktif', icon: Radio, badge: inProgress > 0 ? inProgress : null },
                                { id: 'answers', label: 'Sinkronisasi Jawaban', icon: ShieldAlert, badge: null as number | null },
                                { id: 'results', label: 'Hasil Ujian', icon: Users, badge: null as number | null },
                                { id: 'analysis', label: 'Analisis Soal', icon: TrendingUp, badge: null as number | null },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                    className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                                        activeTab === tab.id
                                            ? 'bg-[#3083FF] text-white shadow-sm'
                                            : 'text-slate-500 hover:bg-white hover:text-slate-800'
                                    }`}
                                >
                                    <tab.icon size={14} />
                                    {tab.label}
                                    {tab.badge && (
                                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex min-w-0 flex-1 gap-2">
                        <div className="min-w-0 flex-1">
                            <InlineSelect
                                className="w-full"
                                minWidth="100%"
                                height="42px"
                                title="Pilih ujian"
                                options={sortMonitoringExams(exams, monitoringNow).map(exam => ({
                                    value: exam.id,
                                    label: monitoringExamLabel(exam, monitoringNow),
                                }))}
                                value={selectedExamId}
                                onChange={(val) => setSelectedExamId(String(val || ''))}
                            />
                        </div>
                        <button
                            type="button"
                            aria-label="Refresh data monitoring"
                            title="Refresh data monitoring"
                            onClick={handleRefresh}
                            disabled={isRefreshing || !selectedExamId}
                            className="inline-flex h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#3083FF] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#2672e8] disabled:cursor-not-allowed disabled:opacity-40">
                            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                    </div>
                </div>
                {selectedExamId && (activeTab === 'live' || activeTab === 'results') && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                    <FilterToolbar>
                        <FilterSearch
                            value={searchName}
                            onChange={setSearchName}
                            label="Nama peserta"
                            placeholder="Cari nama peserta..."
                            grow={1}
                            width="220px"
                            className="[&_.ftb-input]:!text-[13px] [&_.ftb-input]:!font-normal"
                        />
                        <div className="min-w-[220px] flex-[1_1_220px]">
                            <MultiSelect
                                placeholder="Semua Kelas"
                                allSelectedText="Semua Kelas Terpilih"
                                options={kelasOptions.map(k => ({ value: k, label: k }))}
                                value={filterKelas}
                                onChange={(vals) => setFilterKelas(vals)}
                                height="38px"
                                className="[&_.uimsel-trigger]:!text-[13px] [&_.uimsel-trigger]:!font-normal"
                            />
                        </div>
                        <div className="min-w-[220px] flex-[1_1_220px]">
                            <InlineSelect
                                value={filterStatus}
                                onChange={(val) => setFilterStatus(val)}
                                title="Filter berdasarkan status"
                                minWidth="100%"
                                height="38px"
                                className="w-full [&_.uisel-input]:!text-[13px] [&_.uisel-input]:!font-normal"
                                options={[
                                    { value: 'all', label: 'Semua Status' },
                                    { value: 'in_progress', label: 'Sedang Ujian' },
                                    { value: 'submitted', label: 'Selesai' },
                                    { value: 'auto_submitted', label: 'Terminated' },
                                    { value: 'belum', label: 'Belum Mulai' },
                                ]}
                            />
                        </div>
                    </FilterToolbar>
                    </div>
                )}
            </div>

            {selectedExamId && (
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {[
                        { label: 'Total peserta', value: totalStudents, icon: Users },
                        { label: 'Belum mulai', value: belumMengerjakan, icon: UserX },
                        { label: 'Mengerjakan', value: inProgress, icon: Activity, pulse: inProgress > 0 },
                        { label: 'Selesai', value: completed, icon: CheckCircle2 },
                        { label: 'Pelanggaran', value: totalViolations, icon: AlertOctagon, alert: totalViolations > 0 },
                    ].map((stat) => (
                        <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                stat.alert ? 'bg-red-50 text-red-600' : 'bg-[#3083FF]/10 text-[#3083FF]'
                            }`}>
                                <stat.icon size={17} className={stat.pulse ? 'animate-pulse text-emerald-600' : ''} />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-lg font-bold leading-tight text-slate-800">{stat.value}</span>
                                <span className="block truncate text-[11px] text-slate-500">{stat.label}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {selectedExamId && activeTab === 'answers' && (
                <MonitoringHealthPanel
                    attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)}
                    onRecover={handleResetAttempt}
                    onViewDetails={attemptId => router.push(`/dashboard/admin/monitoring/${attemptId}`)}
                    defaultExpanded
                />
            )}

            {selectedExamId && loadError && (
                <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">Data monitoring belum berhasil dimuat.</p>
                        <p className="mt-1 break-words">{loadError}</p>
                        {attempts.length > 0 && (
                            <p className="mt-1 text-xs text-red-700">Data yang terlihat mungkin merupakan hasil pemuatan sebelumnya.</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold hover:bg-red-100 disabled:opacity-50"
                    >
                        Coba lagi
                    </button>
                </div>
            )}

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

            {selectedExamId && activeTab === 'live' && (
                <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Peserta ujian aktif">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                        <h3 className="font-semibold text-slate-800">Peserta Aktif</h3>
                        <span className="text-xs text-slate-500">{activeAttempts.length} peserta</span>
                    </div>
                    {activeAttempts.length === 0 ? (
                        <div className="px-5 py-12 text-center text-sm text-slate-500">
                            {attempts.length ? 'Tidak ada peserta aktif yang cocok dengan filter.' : 'Belum ada peserta yang memulai ujian.'}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-left text-sm">
                                <thead className="bg-white text-xs text-slate-500">
                                    <tr>
                                        <th className="px-5 py-3 font-semibold">Nama siswa</th>
                                        <th className="px-5 py-3 font-semibold">Kelas</th>
                                        <th className="px-5 py-3 font-semibold">Mulai ujian</th>
                                        <th className="px-5 py-3 text-right font-semibold">Pelanggaran</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeAttempts.map(attempt => {
                                        const violations = attempt.warning_count ?? 0;
                                        return (
                                            <tr key={attempt.id} className="border-t border-slate-100 hover:bg-slate-50">
                                                <td className="px-5 py-3 text-xs font-medium text-slate-800">{formatStudentName(attempt.profiles?.full_name, 'Tanpa nama')}</td>
                                                <td className="px-5 py-3 text-slate-600">{attempt.kelas_name || '—'}</td>
                                                <td className="px-5 py-3 text-slate-600">
                                                    {attempt.started_at ? new Date(attempt.started_at).toLocaleString('id-ID', { timeZone }) : 'Belum tercatat'}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-semibold ${violations > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                                                    {violations}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {selectedExamId && (
                <div className="space-y-4">

                    <AnimatePresence mode="wait">
                        {/* === LIVE TAB === */}
                        {activeTab === 'live' && (
                            <motion.div
                                key="live"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className={activeTab === 'live' ? 'hidden' : 'space-y-4'}
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
                                                <p className="text-slate-300 text-xs mt-2">Semua peserta sudah selesai — lihat tab Hasil Ujian.</p>
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
                                                    const isInProgress = att.status === 'in_progress';
                                                    const isTerminated = att.status === 'auto_submitted';
                                                    const isBelum = att.status === 'belum';
                                                    // Reset juga tersedia untuk ujian yang SUDAH disubmit (salah pencet
                                                    // "Selesai" / guru minta perbaikan) — bukan hanya yang di-terminate.
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
                                                                    <p className="text-[10px] font-semibold uppercase tracking-wider mt-0.5">
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
                                                                    onClick={() => router.push(`/dashboard/admin/monitoring/${att.id}`)}
                                                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#3083FF] hover:bg-[#3083FF]/80 text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all"
                                                                >
                                                                    <Eye size={11} /> Detail
                                                                </button>
                                                                {canReset && (
                                                                    <button
                                                                        onClick={() => handleResetAttempt(att)}
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
                                                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
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
                                                                            onClick={() => router.push(`/dashboard/admin/monitoring/${att.id}`)}
                                                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3083FF] hover:bg-[#3083FF]/80 text-white rounded text-[10px] font-semibold uppercase tracking-wider transition-all"
                                                                        >
                                                                            <Eye size={11} /> Detail
                                                                        </button>
                                                                        {canReset && (
                                                                            <button
                                                                                onClick={() => handleResetAttempt(att)}
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
                                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4">
                                    <h3 className="font-bold text-slate-800">Rekap Hasil</h3>
                                    <div className="flex gap-2">
                                        {hasIRTScoring && (
                                            <button type="button" onClick={handleCalculateIRT} disabled={isRefreshing}
                                                aria-label="Kalkulasi IRT" title="Kalkulasi IRT"
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50">
                                                <Calculator size={16} />
                                            </button>
                                        )}
                                        <button type="button" onClick={exportResultsToExcel}
                                            aria-label="Ekspor rekap" title="Ekspor rekap"
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100">
                                            <FileSpreadsheet size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[900px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-left font-bold text-slate-600">Nama Peserta</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Kelas</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Status</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Pelanggaran</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Durasi</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Mulai</th>
                                                <th className="p-4 text-left font-bold text-slate-600">Selesai</th>
                                                <th className="p-4 text-right font-bold text-slate-600">Skor Klasik</th>
                                                {has1PL && <th className="p-4 text-right font-bold text-slate-600">IRT 1PL</th>}
                                                {has2PL && <th className="p-4 text-right font-bold text-slate-600">IRT 2PL</th>}
                                                {has3PL && <th className="p-4 text-right font-bold text-slate-600">IRT 3PL</th>}
                                                {!has1PL && !has2PL && !has3PL && <th className="p-4 text-right font-bold text-slate-600">Skor IRT</th>}
                                                <th className="p-4 text-center font-bold text-slate-600">Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {finishedAttempts.length === 0 ? (
                                                <tr><td colSpan={rekapColCount} className="p-12 text-center text-slate-400 font-medium">
                                                    {attempts.length > 0 ? 'Belum ada peserta yang selesai (atau tidak cocok dengan filter)' : 'Belum ada data'}
                                                </td></tr>
                                            ) : (
                                                finishedAttempts.map((att) => {
                                                    // Kolom Pelanggaran = warning_count (semua jenis), konsisten
                                                    // dengan kartu Live; sebelumnya menampilkan pindah-tab saja.
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
                                                            onClick={() => {
                                                                if (isBelum) return;
                                                                router.push(`/dashboard/admin/monitoring/${att.id}`);
                                                            }}
                                                            className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors ${isBelum ? '' : 'cursor-pointer'}`}
                                                        >
                                                            <td className="p-4 text-xs font-medium text-slate-800">{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</td>
                                                            <td className="p-4 text-[10px] font-semibold text-slate-500">{att.kelas_name || '-'}</td>
                                                            <td className="p-4">
                                                                <span className={`px-3 py-1 rounded-lg text-[9px] font-semibold uppercase tracking-wider border ${
                                                                    isTerminated
                                                                        ? 'bg-pink-100 text-pink-700 border-pink-300'
                                                                        : att.status === 'submitted'
                                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                        : isBelum
                                                                        ? 'bg-slate-50 text-slate-500 border-slate-200'
                                                                        : 'bg-slate-100 text-slate-600 border-slate-200'
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
                                                            <td className="p-4 text-[10px] font-semibold text-slate-600">{duration}</td>
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
                                                                            router.push(`/dashboard/admin/monitoring/${att.id}`);
                                                                        }}
                                                                        disabled={isBelum}
                                                                        type="button"
                                                                        aria-label={`Detail ${formatStudentName(att.profiles?.full_name, 'peserta')}`}
                                                                        title="Lihat detail"
                                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    {canReset && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleResetAttempt(att);
                                                                            }}
                                                                            disabled={resettingAttemptId === att.id}
                                                                            type="button"
                                                                            aria-label={`Pulihkan ${formatStudentName(att.profiles?.full_name, 'peserta')}`}
                                                                            title="Susulan / Pulihkan"
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
                                                                        >
                                                                            {resettingAttemptId === att.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
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
                                    <table className="w-full min-w-[700px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-14">No</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Soal</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-20">Tipe</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-28">Kesukaran</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Menjawab</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Benar</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Salah</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Belum Ternilai</th>
                                                <th className="p-4 text-right font-bold text-[#3083FF]">% Salah</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysis.length === 0 ? (
                                                <tr><td colSpan={9} className="p-12 text-center text-slate-400 font-medium">Belum ada data</td></tr>
                                            ) : (
                                                pagedAnalysis.map((anl) => {
                                                    const isCritical = anl.incorrectPercentage > 50;
                                                    const diffLabel = anl.difficultyLabel?.toLowerCase() || '';
                                                    const diffColor =
                                                        diffLabel === 'mudah'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : diffLabel === 'sukar'
                                                            ? 'bg-red-50 text-red-700 border-red-200'
                                                            : 'bg-amber-50 text-amber-700 border-amber-200';

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
                                                                            onClick={() => {
                                                                                setViewQuestion(anl);
                                                                                setModalActiveTab('soal');
                                                                            }}
                                                                            className="mt-2 text-xs font-semibold text-[#3083FF] hover:text-[#2563EB] flex items-center gap-1 transition-colors"
                                                                        >
                                                                            <Eye size={12} /> Detail Soal & Jawaban Siswa
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-600">
                                                                    {anl.type || 'mcq'}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                {anl.difficultyLabel ? (
                                                                    <span className={`px-2 py-0.5 border rounded text-[10px] font-bold uppercase ${diffColor}`}>
                                                                        {anl.difficultyLabel}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-slate-400">-</span>
                                                                )}
                                                            </td>
                                                            <td className="p-4 text-center font-bold text-slate-500">{anl.total}</td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setViewQuestion(anl);
                                                                        setModalActiveTab('benar');
                                                                    }}
                                                                    className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold transition-all text-xs"
                                                                    title="Klik untuk melihat siswa yang menjawab benar"
                                                                >
                                                                    {anl.correct}
                                                                </button>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setViewQuestion(anl);
                                                                        setModalActiveTab('salah');
                                                                    }}
                                                                    className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold transition-all text-xs"
                                                                    title="Klik untuk melihat siswa yang menjawab salah"
                                                                >
                                                                    {anl.incorrect}
                                                                </button>
                                                            </td>
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
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
                        onClick={() => setViewQuestion(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0, y: 12 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.96, opacity: 0, y: 12 }}
                            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full h-[88dvh] max-h-[88dvh] min-h-0 overflow-hidden flex flex-col border border-slate-100"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-slate-800 text-lg">
                                        Detail Butir Soal{viewQuestion.number ? ` No. ${viewQuestion.number}` : ''}
                                    </h3>
                                    <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold uppercase tracking-wider">
                                        {viewQuestion.type || 'mcq'}
                                    </span>
                                    {viewQuestion.difficultyLabel && (
                                        <span className={`px-2.5 py-0.5 border rounded-full text-[11px] font-bold uppercase tracking-wider ${
                                            viewQuestion.difficultyLabel === 'Sukar' ? 'bg-red-50 text-red-700 border-red-200' :
                                            viewQuestion.difficultyLabel === 'Sedang' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        }`}>
                                            {viewQuestion.difficultyLabel} {viewQuestion.difficultyIndex !== undefined ? `(P: ${viewQuestion.difficultyIndex.toFixed(2)})` : ''}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setViewQuestion(null)}
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Tabs Bar */}
                            <div className="shrink-0 px-6 pt-2 border-b border-slate-200 bg-white flex items-center gap-2 overflow-x-auto">
                                <button
                                    onClick={() => setModalActiveTab('soal')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'soal'
                                            ? 'border-[#3083FF] text-[#3083FF]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Eye size={14} />
                                    Teks Soal & Kunci
                                </button>
                                <button
                                    onClick={() => setModalActiveTab('benar')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'benar'
                                            ? 'border-emerald-500 text-emerald-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <UserCheck size={14} className="text-emerald-500" />
                                    Siswa Benar
                                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">
                                        {viewQuestion.correctStudents?.length ?? viewQuestion.correct}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setModalActiveTab('salah')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'salah'
                                            ? 'border-red-500 text-red-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <UserX size={14} className="text-red-500" />
                                    Siswa Salah
                                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-100 text-red-700">
                                        {viewQuestion.wrongStudents?.length ?? viewQuestion.incorrect}
                                    </span>
                                </button>
                                {(viewQuestion.distractorDistribution?.length ?? 0) > 0 && (
                                    <button
                                        onClick={() => setModalActiveTab('distraktor')}
                                        className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                            modalActiveTab === 'distraktor'
                                                ? 'border-purple-500 text-purple-600'
                                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                        }`}
                                    >
                                        <PieChart size={14} className="text-purple-500" />
                                        Sebaran Pengecoh
                                    </button>
                                )}
                            </div>

                            {/* Modal Content */}
                            <div className="min-h-0 p-6 overflow-y-auto flex-1 bg-slate-50/30">
                                {modalActiveTab === 'soal' && (
                                    <div className="space-y-5">
                                        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Teks Soal</div>
                                            <LatexRenderer text={viewQuestion.qText} className="text-base text-slate-800 leading-relaxed" />
                                        </div>

                                        {(viewQuestion.options?.length ?? 0) > 0 && (
                                            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pilihan Opsi & Kunci Jawaban</div>
                                                <div className="space-y-2">
                                                    {viewQuestion.options.map((opt, i) => (
                                                        <div
                                                            key={opt.id || i}
                                                            className={`flex items-start gap-3 p-3 rounded-lg border text-sm transition-colors ${
                                                                opt.is_correct
                                                                    ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-300'
                                                                    : 'bg-slate-50 border-slate-200/70'
                                                            }`}
                                                        >
                                                            <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                                opt.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                                                            }`}>
                                                                {String.fromCharCode(65 + i)}
                                                            </span>
                                                            <div className="flex-1 min-w-0 pt-0.5">
                                                                <LatexRenderer text={opt.option_text || ''} className="!text-sm !leading-relaxed" />
                                                            </div>
                                                            {opt.is_correct && (
                                                                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                                                    <CheckCircle2 size={13} /> Kunci Jawaban
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {viewQuestion.keyDisplay && (
                                            <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-200 flex items-center justify-between text-xs text-blue-900">
                                                <span className="font-semibold">Kunci Jawaban Resmi:</span>
                                                <span className="font-bold bg-white px-3 py-1 rounded border border-blue-200">{viewQuestion.keyDisplay}</span>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                                            <div className="bg-white p-3 rounded-xl border border-slate-200">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase">Total Menjawab</div>
                                                <div className="text-xl font-bold text-slate-700 mt-1">{viewQuestion.total}</div>
                                            </div>
                                            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                                                <div className="text-[10px] font-bold text-emerald-600 uppercase">Jawaban Benar</div>
                                                <div className="text-xl font-bold text-emerald-700 mt-1">{viewQuestion.correct}</div>
                                            </div>
                                            <div className="bg-red-50 p-3 rounded-xl border border-red-200">
                                                <div className="text-[10px] font-bold text-red-600 uppercase">Jawaban Salah</div>
                                                <div className="text-xl font-bold text-red-700 mt-1">{viewQuestion.incorrect}</div>
                                            </div>
                                            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                                                <div className="text-[10px] font-bold text-amber-600 uppercase">Belum Dinilai</div>
                                                <div className="text-xl font-bold text-amber-700 mt-1">{viewQuestion.ungraded ?? 0}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {modalActiveTab === 'benar' && (
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="p-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 size={16} className="text-emerald-600" />
                                                <span className="font-bold text-sm text-emerald-900">
                                                    Daftar Siswa yang Menjawab Benar ({viewQuestion.correctStudents?.length ?? 0})
                                                </span>
                                            </div>
                                            <span className="text-xs text-emerald-700 font-medium">Nilai Poin Diperoleh Penuh</span>
                                        </div>

                                        {(!viewQuestion.correctStudents || viewQuestion.correctStudents.length === 0) ? (
                                            <div className="p-8 text-center text-slate-400 text-sm">
                                                Belum ada siswa yang menjawab dengan benar untuk butir soal ini.
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto max-h-[50vh]">
                                                <table className="w-full text-left border-collapse text-xs">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                        <tr>
                                                            <th className="p-3 w-12 text-center">No</th>
                                                            <th className="p-3">Nama Siswa</th>
                                                            <th className="p-3">Kelas</th>
                                                            <th className="p-3">NISN / Identitas</th>
                                                            <th className="p-3">Jawaban Diberikan</th>
                                                            <th className="p-3 text-right">Skor</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {viewQuestion.correctStudents.map((st, i) => (
                                                            <tr key={i} className="hover:bg-emerald-50/30 transition-colors">
                                                                <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                                <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                                <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                                <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                                                                        {st.display_answer || 'Benar'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-right font-bold text-emerald-600">
                                                                    +{st.score !== undefined ? st.score : 1}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalActiveTab === 'salah' && (
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="p-4 bg-red-50/50 border-b border-red-100 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle size={16} className="text-red-600" />
                                                <span className="font-bold text-sm text-red-900">
                                                    Daftar Siswa yang Menjawab Salah ({viewQuestion.wrongStudents?.length ?? 0})
                                                </span>
                                            </div>
                                            <span className="text-xs text-red-700 font-medium">Perlu Perhatian & Remedial</span>
                                        </div>

                                        {(!viewQuestion.wrongStudents || viewQuestion.wrongStudents.length === 0) ? (
                                            <div className="p-8 text-center text-emerald-600 font-medium text-sm">
                                                Luar biasa! Tidak ada siswa yang menjawab salah untuk butir soal ini.
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto max-h-[50vh]">
                                                <table className="w-full text-left border-collapse text-xs">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                        <tr>
                                                            <th className="p-3 w-12 text-center">No</th>
                                                            <th className="p-3">Nama Siswa</th>
                                                            <th className="p-3">Kelas</th>
                                                            <th className="p-3">NISN / Identitas</th>
                                                            <th className="p-3">Jawaban Siswa</th>
                                                            <th className="p-3">Kunci Jawaban</th>
                                                            <th className="p-3 text-right">Skor</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {viewQuestion.wrongStudents.map((st, i) => (
                                                            <tr key={i} className="hover:bg-red-50/30 transition-colors">
                                                                <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                                <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                                <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                                <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                                                                        {st.display_answer || '(Kosong / Salah)'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px]">
                                                                        {viewQuestion.keyDisplay || '-'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-right font-bold text-red-500">
                                                                    {st.score !== undefined ? st.score : 0}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalActiveTab === 'distraktor' && (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-200 flex items-center justify-between text-xs text-purple-900">
                                            <span className="font-semibold">Analisis Distribusi Pemilihan Opsi (Pengecoh / Distractor):</span>
                                            <span className="text-[11px] text-purple-700">Membantu mengevaluasi efektivitas distraktor soal</span>
                                        </div>

                                        <div className="space-y-3">
                                            {(viewQuestion.distractorDistribution || []).map((dist) => (
                                                <div key={dist.option_id} className={`p-4 rounded-xl border transition-all ${
                                                    dist.is_correct ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-slate-200'
                                                }`}>
                                                    <div className="flex items-center justify-between gap-4 mb-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                                dist.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                                            }`}>
                                                                {dist.option_letter}
                                                            </span>
                                                            <div className="truncate text-xs text-slate-700 font-medium">
                                                                {dist.option_text ? dist.option_text.substring(0, 80) : ''}
                                                            </div>
                                                            {dist.is_correct && (
                                                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                                                    KUNCI
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className="font-bold text-sm text-slate-800">{dist.count} siswa</span>
                                                            <span className="text-xs text-slate-500 ml-1.5 font-semibold">({dist.percentage.toFixed(1)}%)</span>
                                                        </div>
                                                    </div>

                                                    {/* Progress bar */}
                                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${
                                                                dist.is_correct ? 'bg-emerald-500' : 'bg-[#3083FF]'
                                                            }`}
                                                            style={{ width: `${Math.min(100, dist.percentage)}%` }}
                                                        />
                                                    </div>

                                                    {/* Students who selected this option */}
                                                    {dist.student_names && dist.student_names.length > 0 && (
                                                        <div className="pt-2 border-t border-slate-100">
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                                Siswa yang Memilih:
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {dist.student_names.map((nm: string, sIdx: number) => (
                                                                    <span
                                                                        key={sIdx}
                                                                        className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                                                                            dist.is_correct
                                                                                ? 'bg-emerald-100/70 text-emerald-800'
                                                                                : 'bg-slate-100 text-slate-700'
                                                                        }`}
                                                                    >
                                                                        {formatStudentName(nm, 'Tanpa Nama')}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="shrink-0 px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                                <div className="text-xs text-slate-500">
                                    {viewQuestion.discriminationLabel && (
                                        <span>Daya Beda: <strong className="text-slate-700">{viewQuestion.discriminationLabel}</strong> ({viewQuestion.discriminationIndex?.toFixed(2) ?? '-'})</span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setViewQuestion(null)}
                                    className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors shadow-sm"
                                >
                                    Tutup
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ResetExamModal
                open={!!selectedResetAttempt}
                attempt={selectedResetAttempt}
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
