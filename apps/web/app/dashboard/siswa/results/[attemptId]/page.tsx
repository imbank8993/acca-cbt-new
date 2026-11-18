"use client";
import './student-result.css';
import { ResultImagePreview } from '@/app/components/questions/ResultImagePreview';
import { selectedStudentScore, studentScoreType, STUDENT_SCORE_LABELS } from '@acca-cbt/shared';
import { TopicAnalysisPanel } from '@/app/components/monitoring/TopicAnalysisPanel';
import { QuestionRenderer } from '@/app/components/questions/QuestionRenderer';
import { QuestionSearchBar } from '@/app/components/QuestionSearchBar';
import { matchesQuestionSearch } from '@/lib/question-search';
import { getAttemptDetailsResult,type StudentAttemptAnswer,type StudentAttemptDetails,type StudentResultQuestion } from '@/lib/api/students';
import { formatSchoolDateTime } from '@/lib/school-time';
import { getSessionUser } from '@/lib/session';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { AnimatePresence,motion } from 'framer-motion';
import { BarChart3,BookOpen,Brain,CheckCircle2,Clock,Info,Loader2,Lock,Sparkles,Target,Timer } from 'lucide-react';
import { StudentExamCover, SubjectPill } from '@/app/components/student/StudentExamCover';
import { useParams,useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';

type AnswerFilter = 'semua' | 'benar' | 'salah' | 'kosong';

function isUnanswered(answer: StudentAttemptAnswer) {
    return !answer.selectedOptionId && (answer.essayAnswer == null ||
        (typeof answer.essayAnswer === 'string' && !answer.essayAnswer.trim()));
}

const PERSONALITY_TYPES = ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'];

function hasResultQuestion(
    answer: StudentAttemptAnswer,
): answer is StudentAttemptAnswer & { question: StudentResultQuestion } {
    return answer.question !== null;
}

function StudentAnswerAnalysis({ answer, index }: {
    answer: StudentAttemptAnswer & { question: StudentResultQuestion };
    index: number;
}) {
    const question = answer.question;
    const isEssay = ['essay', 'esay', 'uraian'].includes(question.type.toLowerCase());
    const manualPending = isEssay && answer.isCorrect == null;
    const unanswered = !answer.selectedOptionId &&
        (answer.essayAnswer == null || (typeof answer.essayAnswer === 'string' && !answer.essayAnswer.trim()));
    return (
        <div className="student-answer-analysis bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-200 text-xs text-slate-500">
                <span className="font-semibold">Soal {index + 1} · Bobot {question.score_default ?? 1} poin</span>
                {unanswered && <span className="text-slate-500">Belum dijawab</span>}
                <span>Nilai: <span className="font-bold text-slate-700">{manualPending ? 'Menunggu koreksi' : answer.score ?? '—'}</span></span>
            </div>
            {question.topic && <p className="mb-3 text-xs font-medium text-blue-700">Materi: {question.topic}</p>}
            <div className="bg-white p-3 sm:p-3.5 rounded-lg border border-slate-200 shadow-sm text-sm">
                <QuestionRenderer
                    question={{ ...question, bank_question_options: question.options }}
                    answer={answer.essayAnswer ?? answer.selectedOptionId}
                    onAnswerChange={() => {}}
                    showFeedback={true}
                    showFeedbackLabels={false}
                />
            </div>
        </div>
    );
}

export default function StudentResultDetailsPage() {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const params = useParams();
    const router = useRouter();
    const attemptId = params.attemptId as string;

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [details, setDetails] = useState<StudentAttemptDetails | null>(null);
    const [activeTab, setActiveTab] = useState<'pengetahuan' | 'kepribadian'>('pengetahuan');
    const [questionSearch, setQuestionSearch] = useState('');
    const [section, setSection] = useState<'ringkasan' | 'materi' | 'pembahasan'>('ringkasan');
    const [answerFilter, setAnswerFilter] = useState<AnswerFilter>('semua');

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        setDetails(null);
        const user = await getSessionUser();
        if (user) {
            const response = await getAttemptDetailsResult(attemptId);
            if (!response.success) {
                setLoadError(response.error);
                setLoading(false);
                return;
            }
            const data = response.details;
            setDetails(data);
            // Auto-switch to kepribadian if no academic answers
            if (data) {
                const pengetahuanAnswers = (data.answers || []).filter(
                    (answer) => !PERSONALITY_TYPES.includes(answer.question?.type || '')
                );
                if (pengetahuanAnswers.length === 0 && data.attempt?.metadata?.dimension_scores) {
                    setActiveTab('kepribadian');
                }
            }
        } else {
            setLoadError('Sesi berakhir. Silakan login kembali.');
        }
        setLoading(false);
    }, [attemptId, setLoading]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    const formatUTCDateTime = (str: string) => {
        return str ? formatSchoolDateTime(str, timeZone) : 'N/A';
    };

    if (loading) return (
        <div className="flex justify-center items-center min-h-[60vh]">
            <Loader2 size={48} className="text-primary animate-spin" />
        </div>
    );

    if (!details) return (
        <div role="alert" className="max-w-2xl mx-auto py-20 text-center bg-white border border-slate-100 rounded-[2rem] p-10">
            <p className="text-slate-400 font-bold uppercase tracking-widest text-sm mb-4">
                Detail hasil ujian belum dapat ditampilkan.
            </p>
            <p className="text-sm text-slate-600 mb-4">{loadError || 'Data hasil ujian tidak ditemukan.'}</p>
            <button
                type="button"
                onClick={() => void load()}
                className="mr-2 mt-2 px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-200"
            >
                Coba Lagi
            </button>
            <button
                onClick={() => router.push('/dashboard/siswa/results')}
                className="mt-2 px-6 py-2.5 bg-primary text-white rounded-xl font-medium text-sm hover:opacity-90"
            >
                Kembali ke Hasil
            </button>
        </div>
    );

    const { attempt, answers } = details;

    // Separate answers into pengetahuan and kepribadian
    const answersWithQuestions = answers.filter(hasResultQuestion);
    const pengetahuanAnswers = answersWithQuestions.filter((answer) => !PERSONALITY_TYPES.includes(answer.question.type));
    const kepribadianAnswers = answersWithQuestions.filter((answer) => PERSONALITY_TYPES.includes(answer.question.type));
    const searchedAnswers = answersWithQuestions.map((answer, index) => ({ answer, index })).filter(({ answer, index }) =>
        matchesQuestionSearch(answer.question.question_text, index + 1, questionSearch));
    const visiblePengetahuan = searchedAnswers.filter(({ answer }) => !PERSONALITY_TYPES.includes(answer.question.type) &&
        (answerFilter === 'semua' || (answerFilter === 'kosong' ? isUnanswered(answer) :
            !isUnanswered(answer) && answer.isCorrect === (answerFilter === 'benar'))));
    const visibleKepribadian = searchedAnswers.filter(({ answer }) => PERSONALITY_TYPES.includes(answer.question.type));

    const correctCount = pengetahuanAnswers.filter((answer) => answer.isCorrect).length;
    const totalPengetahuanCount = pengetahuanAnswers.length;
    const unansweredCount = pengetahuanAnswers.filter(isUnanswered).length;
    const incorrectCount = pengetahuanAnswers.filter(answer => !isUnanswered(answer) && answer.isCorrect === false).length;
    const pendingCount = pengetahuanAnswers.filter(answer => !isUnanswered(answer) && answer.isCorrect == null).length;
    const assessedCount = correctCount + incorrectCount + unansweredCount;
    const accuracy = assessedCount > 0 ? Math.round(correctCount / assessedCount * 100) : null;
    const elapsedMs = attempt.started_at && attempt.finished_at
        ? new Date(attempt.finished_at).getTime() - new Date(attempt.started_at).getTime() : NaN;
    const durationMinutes = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs / 60000) : null;
    const durationLabel = durationMinutes == null ? '—' : durationMinutes >= 60
        ? `${Math.floor(durationMinutes / 60)} jam${durationMinutes % 60 ? ` ${durationMinutes % 60} mnt` : ''}`
        : `${durationMinutes} mnt`;

    const displayedScore = attempt.display_score !== undefined ? attempt.display_score : selectedStudentScore(attempt, attempt.exams);
    const scoreLabel = attempt.score_label || STUDENT_SCORE_LABELS[studentScoreType(attempt.exams)];
    const gradingPending = displayedScore == null;
    const totalScore = Number(displayedScore || 0);
    const classicalScore = (attempt.score_type || studentScoreType(attempt.exams)) === 'classical';
    // Satu kalimat penyemangat yang ramah, hanya untuk nilai klasik yang sudah final.
    const cheer = gradingPending || attempt.needs_manual_grading || !classicalScore ? null
        : totalScore >= 90 ? 'Luar biasa! Pertahankan prestasimu.'
        : totalScore >= 75 ? 'Kerja bagus! Sedikit lagi menuju sempurna.'
        : totalScore >= 60 ? 'Sudah baik, terus tingkatkan ya.'
        : 'Jangan menyerah, pelajari lagi materinya ya.';
    const lockedHint = details.answerKeysReleased === false ? 'Tampil setelah pembahasan dibuka' : 'Belum tersedia';


    const hasDimensionScores = attempt.metadata?.dimension_scores && Object.keys(attempt.metadata.dimension_scores).length > 0;
    const dimensionScores = attempt.metadata?.dimension_scores || {};
    const hasKepribadian = kepribadianAnswers.length > 0 || hasDimensionScores;
    const hasPengetahuan = pengetahuanAnswers.length > 0;

    // Tabs config — only show kepribadian tab if there's personality data
    const tabs = [
        ...(hasPengetahuan ? [{ id: 'pengetahuan' as const, label: 'Pengetahuan', icon: BookOpen, color: 'text-blue-600', activeBg: 'bg-blue-600', count: totalPengetahuanCount }] : []),
        ...(hasKepribadian ? [{ id: 'kepribadian' as const, label: 'Kepribadian', icon: Brain, color: 'text-indigo-600', activeBg: 'bg-indigo-600', count: kepribadianAnswers.length }] : []),
    ];

    // Make sure activeTab is valid
    const resolvedTab = tabs.find(t => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'pengetahuan');

    return (
        <ResultImagePreview className="max-w-7xl mx-auto space-y-6 pb-24 animate-in fade-in duration-700">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}
            <header className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-violet-50 px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm dark:border-slate-800 dark:from-sky-500/10 dark:via-slate-900 dark:to-violet-500/10">
                <div className="flex items-center gap-3.5">
                    <StudentExamCover cover={attempt.exams?.cover_url} title={attempt.exams?.title || 'Ujian'} subject={attempt.exams?.subject} size={44} />
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg sm:text-xl font-bold leading-tight tracking-tight text-slate-900 dark:text-white">{attempt.exams?.title || 'Detail hasil ujian'}</h1>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <SubjectPill subject={attempt.exams?.subject} />
                            {cheer && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                <Sparkles size={12} aria-hidden="true" />{cheer}</span>}
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 sm:ml-1"><Clock size={13} aria-hidden="true" /> Mulai {attempt.started_at ? formatUTCDateTime(attempt.started_at) : '—'}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Selesai {attempt.finished_at ? formatUTCDateTime(attempt.finished_at) : '—'}</span>
                        </div>
                    </div>
                </div>
            </header>

            <section aria-label="Ringkasan nilai" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {(hasPengetahuan || details.answerKeysReleased === false || !hasKepribadian) && <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 p-4 sm:p-5 text-white shadow-md shadow-indigo-500/20">
                    <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
                    <p className="text-sm font-medium text-white/85">{attempt.needs_manual_grading ? 'Nilai sementara' : 'Nilai akhir'}</p>
                    <p className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">{gradingPending ? '—' : totalScore.toFixed(2)}</p>
                    <p className="mt-2 text-xs text-white/80">{gradingPending ? 'Sedang diproses' : `${scoreLabel} · ${classicalScore ? 'Skala 0–100' : 'Skala 200–800'}`}</p>
                </div>}
                <div className="rounded-2xl border p-4 sm:p-5 border-emerald-100 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-500/20"><CheckCircle2 size={15} aria-hidden="true" /></span>Jawaban benar</p>
                    <p className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tabular-nums">{hasPengetahuan ? correctCount : '—'}{hasPengetahuan && <span className="ml-1 text-base font-normal text-slate-400">/ {totalPengetahuanCount}</span>}</p>
                    <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-300/80">{hasPengetahuan ? `${pendingCount ? `${pendingCount} menunggu koreksi` : 'Soal pengetahuan'}` : lockedHint}</p>
                </div>
                <div className="rounded-2xl border p-4 sm:p-5 border-amber-100 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/10">
                    <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20"><Target size={15} aria-hidden="true" /></span>Akurasi</p>
                    <p className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tabular-nums">{accuracy == null ? '—' : `${accuracy}%`}</p>
                    {accuracy != null
                        ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-500/20" aria-hidden="true"><div className="h-full rounded-full bg-amber-400" style={{ width: `${accuracy}%` }} /></div>
                        : <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/80">{lockedHint}</p>}
                </div>
                <div className="rounded-2xl border p-4 sm:p-5 border-violet-100 bg-violet-50/70 dark:border-violet-500/20 dark:bg-violet-500/10">
                    <p className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/20"><Timer size={15} aria-hidden="true" /></span>Durasi</p>
                    <p className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tabular-nums">{durationLabel}</p>
                    <p className="mt-2 text-xs text-violet-700/80 dark:text-violet-300/80">Waktu mulai hingga selesai</p>
                </div>
            </section>

            {(gradingPending || attempt.needs_manual_grading) && (
                <div role="status" className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
                    <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div><p className="font-semibold">{attempt.needs_manual_grading ? 'Menunggu penilaian guru' : scoreLabel.startsWith('IRT') ? 'Skor kemampuan sedang diproses' : 'Nilai sedang diproses'}</p>
                        <p className="mt-1 text-sky-800/90 dark:text-sky-200/90">{attempt.needs_manual_grading ? 'Sebagian jawaban masih memerlukan koreksi. Hasil akan diperbarui setelah penilaian selesai.' : 'Jawaban sudah dikumpulkan. Periksa kembali untuk melihat nilai terbaru.'}</p>
                        <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline underline-offset-4">Muat ulang nilai</button>
                    </div>
                </div>
            )}
            {details.answerKeysReleased === false && (
                <div role="status" className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-900 sm:flex-row sm:items-center dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600 shadow-sm dark:bg-slate-900 dark:text-sky-300"><Lock size={16} aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">Nilaimu sudah tersedia</p>
                        <p className="mt-0.5 text-sky-800/90 dark:text-sky-200/90">{details.answerKeysMessage || 'Kunci jawaban dan pembahasan belum dibuka oleh guru.'}</p>
                    </div>
                    <button type="button" onClick={() => void load()} className="shrink-0 self-start rounded-full bg-white px-4 py-2 text-xs font-semibold text-sky-700 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 sm:self-auto dark:bg-slate-900 dark:text-sky-300 dark:ring-sky-500/20 dark:hover:bg-slate-800">Periksa lagi</button>
                </div>
            )}

            <div role="tablist" aria-label="Tampilan hasil" className="flex gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 dark:bg-slate-800/80">
                {(['ringkasan', 'materi', 'pembahasan'] as const).map(value => <button key={value} type="button" role="tab"
                    id={`result-tab-${value}`} aria-selected={section === value} aria-controls={`result-panel-${value}`}
                    onClick={() => setSection(value)}
                    className={`flex-1 sm:flex-none whitespace-nowrap rounded-full px-3 sm:px-5 py-2 text-sm font-semibold transition-all ${section === value ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                    {value === 'ringkasan' ? 'Ringkasan' : value === 'materi' ? 'Analisis Materi' : 'Pembahasan Soal'}
                </button>)}
            </div>

            {section === 'ringkasan' && <div role="tabpanel" id="result-panel-ringkasan" aria-labelledby="result-tab-ringkasan" className="space-y-5">
                {hasPengetahuan && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <h2 className="font-semibold text-slate-900">Ringkasan jawaban</h2>
                    <p className="mt-1 text-sm text-slate-500">Hasil jawaban pengetahuan pada ujian ini.</p>
                    <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                        {[{ count: correctCount, color: 'bg-emerald-500' }, { count: incorrectCount, color: 'bg-rose-400' }, { count: unansweredCount, color: 'bg-slate-300' }, { count: pendingCount, color: 'bg-amber-400' }].map(item =>
                            <div key={item.color} className={item.color} style={{ width: `${item.count / totalPengetahuanCount * 100}%` }} />)}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        {[{ label: 'Benar', count: correctCount, color: 'bg-emerald-500' }, { label: 'Salah', count: incorrectCount, color: 'bg-rose-400' }, { label: 'Kosong', count: unansweredCount, color: 'bg-slate-300' }, ...(pendingCount ? [{ label: 'Menunggu koreksi', count: pendingCount, color: 'bg-amber-400' }] : [])].map(item =>
                            <span key={item.label} className="inline-flex items-center gap-2 text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} aria-hidden="true" />{item.label} <strong className="text-slate-900">{item.count}</strong></span>)}
                    </div>
                    <p className="mt-4 text-xs text-slate-500">Akurasi = benar ÷ (benar + salah + kosong). Jawaban menunggu koreksi belum dihitung.</p>
                </section>}
                {/* Profil kepribadian adalah hasil: tampil bersama nilai, tidak menunggu pembahasan dibuka. */}
                {hasDimensionScores && (
                    <div className="bg-white border border-indigo-100 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
                                <BarChart3 className="text-white" size={17} />
                            </div>
                            <div>
                                <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">Profil Karakter</h2>
                                <p className="text-[10px] text-slate-400 font-medium">Skor per Dimensi Kepribadian</p>
                            </div>
                        </div>

                        {/* Dimension Interpretations (Professional) */}
                        <div className="space-y-4 mb-6">
                            {(() => {
                                const entries = Object.entries(dimensionScores);
                                entries.sort((a, b) => b[1] - a[1]); // Sort by highest score first
                                
                                return entries.map(([dimId, score]) => {
                                    const dimName = details.dimensions.find((dimension) => dimension.id === dimId)?.name || 'Dimensi';
                                    
                                    // Find the matching interpretation for this score
                                    const matchedInterp = details.interpretations.find((interp) =>
                                        interp.dimension_id === dimId && 
                                        score >= interp.min_score && 
                                        score <= interp.max_score
                                    );

                                    return (
                                        <div key={dimId} className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                                                <h3 className="text-xs font-black uppercase tracking-widest text-indigo-800">{dimName}</h3>
                                                <span className="inline-block px-2.5 py-1 bg-indigo-600 text-white text-[10px] font-black rounded-lg shadow-sm">
                                                    Skor: {Number(score).toFixed(0)}
                                                </span>
                                            </div>
                                            
                                            {matchedInterp ? (
                                                <div className="space-y-1.5">
                                                    <div className="text-sm font-bold text-slate-800">{matchedInterp.title}</div>
                                                    <p className="text-xs text-slate-600 leading-relaxed">
                                                        {matchedInterp.interpretation}
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-indigo-800/60 italic">
                                                    Belum ada analisis mendetail yang tersedia untuk skor ini. Secara umum, skor ini mengindikasikan tingkat respons Anda terhadap dimensi karakter ini.
                                                </p>
                                            )}
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* Dimension Bars (Overview) */}
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 px-1">Ringkasan Spektrum</h3>
                            <div className="space-y-3">
                                {(() => {
                                    const entries = Object.entries(dimensionScores);
                                    entries.sort((a, b) => b[1] - a[1]);
                                    const maxScore = entries[0]?.[1] || 1;
                                    return entries.map(([dimId, score], i) => {
                                        const dimName = details.dimensions.find((dimension) => dimension.id === dimId)?.name || 'Dimensi';
                                        const pct = Math.round((Number(score) / Number(maxScore)) * 100);
                                        return (
                                            <div key={dimId}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{dimName}</span>
                                                    <span className="text-sm font-black text-indigo-600">{Number(score).toFixed(0)}</span>
                                                </div>
                                                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${pct}%` }}
                                                        transition={{ duration: 0.7, delay: i * 0.1 }}
                                                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </div>
                    </div>
                )}
                {!hasDimensionScores && kepribadianAnswers.length > 0 && <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-800">
                    Jawaban kepribadian tersedia di Pembahasan Soal pada bagian Kepribadian.
                </div>}
            </div>}

            {section === 'materi' && <div role="tabpanel" id="result-panel-materi" aria-labelledby="result-tab-materi" className="space-y-5">
                {details.answerKeysReleased === false ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Analisis materi tersedia setelah pembahasan dibuka oleh guru.</div>
                ) : details.topicAnalysis?.topics.length ? (
                    <TopicAnalysisPanel analysis={details.topicAnalysis} personal />
                ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Analisis materi belum tersedia untuk ujian ini.</div>
                )}
            </div>}

            {section === 'pembahasan' && <div role="tabpanel" id="result-panel-pembahasan" aria-labelledby="result-tab-pembahasan" className="space-y-5">
                {details.answerKeysReleased === false && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{details.answerKeysMessage || 'Pembahasan belum dibuka oleh guru.'}</div>}
                {details.answerKeysReleased !== false && <div className="flex flex-wrap items-center gap-2">
                    {tabs.length > 1 && tabs.map(tab => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-pressed={resolvedTab === tab.id}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${resolvedTab === tab.id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{tab.label}</button>)}
                    {resolvedTab === 'pengetahuan' && <div className="flex flex-wrap gap-2" aria-label="Filter jawaban">
                        {(['semua', 'benar', 'salah', 'kosong'] as const).map(filter => <button key={filter} type="button" onClick={() => setAnswerFilter(filter)} aria-pressed={answerFilter === filter}
                            className={`rounded-lg border px-3 py-2 text-sm capitalize ${answerFilter === filter ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>{filter}</button>)}
                    </div>}
                </div>}


            {/* Tab Content */}
            {details.answerKeysReleased !== false && answersWithQuestions.length > 0 && (
                <QuestionSearchBar value={questionSearch} onChange={setQuestionSearch}
                    matched={resolvedTab === 'pengetahuan' ? visiblePengetahuan.length : visibleKepribadian.length}
                    total={resolvedTab === 'pengetahuan' ? pengetahuanAnswers.length : kepribadianAnswers.length} />
            )}
            {details.answerKeysReleased !== false && (
            <AnimatePresence mode="wait">
                {/* ── PENGETAHUAN TAB ── */}
                {resolvedTab === 'pengetahuan' && (
                    <motion.div
                        key="pengetahuan"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-5"
                    >
                        {visiblePengetahuan.length === 0 ? (
                            <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
                                <BookOpen className="mx-auto mb-3 text-slate-300" size={36} />
                                <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">{questionSearch.trim() || answerFilter !== 'semua' ? 'Tidak ada soal yang cocok dengan pencarian atau filter' : 'Tidak ada soal pengetahuan'}</p>
                            </div>
                        ) : (
                            visiblePengetahuan.map(({ answer, index }) => (
                                <StudentAnswerAnalysis key={answer.id} answer={answer} index={index} />
                            ))
                        )}
                    </motion.div>
                )}

                {/* ── KEPRIBADIAN TAB ── */}
                {resolvedTab === 'kepribadian' && (
                    <motion.div
                        key="kepribadian"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-6"
                    >
                        {/* Personality Question Answers */}
                        {kepribadianAnswers.length > 0 && (
                            <div className="space-y-5">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Detail Jawaban Kepribadian</p>
                                {visibleKepribadian.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Tidak ada soal yang cocok dengan pencarian.</p>}
                                {visibleKepribadian.map(({ answer, index }) => (
                                    <StudentAnswerAnalysis key={answer.id} answer={answer} index={index} />
                                ))}
                            </div>
                        )}

                        {!hasDimensionScores && kepribadianAnswers.length === 0 && (
                            <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
                                <Brain className="mx-auto mb-3 text-slate-300" size={36} />
                                <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Tidak ada data kepribadian</p>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            )}
            </div>}
        </ResultImagePreview>
    );
}
