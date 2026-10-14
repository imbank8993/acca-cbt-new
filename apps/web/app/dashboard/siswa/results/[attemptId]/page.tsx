"use client";
import { selectedStudentScore, studentScoreType, STUDENT_SCORE_LABELS } from '@acca-cbt/shared';
import { QuestionRenderer } from '@/app/components/questions/QuestionRenderer';
import { getAttemptDetailsResult,type StudentAttemptAnswer,type StudentAttemptDetails,type StudentResultQuestion } from '@/lib/api/students';
import { formatSchoolDateTime } from '@/lib/school-time';
import { getSessionUser } from '@/lib/session';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { AnimatePresence,motion } from 'framer-motion';
import { ArrowLeft,BarChart3,BookOpen,Brain,Clock,Info,Loader2 } from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';

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
    return (
        <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-200 text-xs text-slate-500">
                <span className="font-semibold">Soal {index + 1} · Bobot {question.score_default ?? 1} poin</span>
                <span>Nilai: <span className="font-bold text-slate-700">{manualPending ? 'Menunggu koreksi' : answer.score ?? '—'}</span></span>
            </div>
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

    const correctCount = pengetahuanAnswers.filter((answer) => answer.isCorrect).length;
    const totalPengetahuanCount = pengetahuanAnswers.length;
    const displayedScore = attempt.display_score !== undefined ? attempt.display_score : selectedStudentScore(attempt, attempt.exams);
    const scoreLabel = attempt.score_label || STUDENT_SCORE_LABELS[studentScoreType(attempt.exams)];
    const gradingPending = displayedScore == null;
    const totalScore = Number(displayedScore || 0);


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
        <div className="max-w-7xl mx-auto space-y-6 pb-24 animate-in fade-in duration-700">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}
            {/* Header & Score Summary Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
                <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
                    <div className="space-y-2 text-left">
                        <button
                            onClick={() => router.push('/dashboard/siswa/results')}
                            className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition-all font-bold uppercase tracking-wider text-[10px] bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl border border-slate-200 active:scale-95 mb-2"
                        >
                            <ArrowLeft size={12} /> Kembali
                        </button>
                        <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-tight uppercase">
                            Detail Hasil Ujian
                        </h1>
                        <p className="text-slate-500 text-xs md:text-sm font-medium leading-relaxed">
                            {attempt.exams?.title}
                        </p>
                    </div>

                    {/* Score cards */}
                    <div className="flex flex-wrap gap-3 self-start xl:self-center shrink-0">
                        {(hasPengetahuan || details.answerKeysReleased === false || !hasKepribadian) && (
                            <div className="bg-slate-50 px-5 py-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
                                <div className="text-center min-w-[60px]">
                                    <p className="text-[8px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">{scoreLabel}</p>
                                    <p className="text-3xl font-black tracking-tighter text-[#3083FF] leading-none font-mono">
                                        {gradingPending ? '—' : totalScore.toFixed(2)}
                                    </p>
                                    <p className="text-[9px] text-slate-400 font-bold mt-1 leading-none">/100</p>
                                    {gradingPending && <p className="mt-2 text-[10px] text-slate-500">{scoreLabel.startsWith('IRT') && !attempt.needs_manual_grading ? 'Menunggu perhitungan IRT' : 'Menunggu penilaian'}</p>}
                                </div>
                                {hasPengetahuan && <>
                                <div className="w-px h-10 bg-slate-200" />
                                <div className="text-center min-w-[60px]">
                                    <p className="text-[8px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">Benar</p>
                                    <p className="text-2xl font-black text-emerald-600 leading-none font-mono mt-0.5">{gradingPending ? '—' : correctCount}</p>
                                    <p className="text-[9px] text-slate-400 font-bold mt-1.5 leading-none">/{totalPengetahuanCount}</p>
                                </div>
                                </>}
                            </div>
                        )}
                    </div>
                </div>

                {/* Tab bar inside card */}
                {tabs.length > 1 && (
                    <div className="mt-6 pt-4 flex gap-2 border-t border-slate-100">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = resolvedTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                                        isActive
                                            ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-xs'
                                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    <Icon size={13} />
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Summary bar */}
            <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 text-slate-500 bg-white border border-slate-100 px-4 py-2.5 rounded-xl">
                    <Clock size={14} />
                    <span className="text-xs font-bold uppercase tracking-widest">Selesai:</span>
                    <span className="font-medium">
                        {attempt.finished_at ? formatUTCDateTime(attempt.finished_at) : 'N/A'}
                    </span>
                </div>
                {attempt.needs_manual_grading && (
                    <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-xl">
                        <Info size={14} />
                        <span className="text-xs font-bold uppercase tracking-widest">Menunggu penilaian manual</span>
                    </div>
                )}
            </div>

            {gradingPending && (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    Jawaban sudah dikumpulkan. Nilai masih diproses.
                    <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">Muat ulang nilai</button>
                </div>
            )}
            {details.answerKeysReleased === false && (
                <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                    <p className="font-semibold">Ringkasan hasil ujian tersedia</p>
                    <p className="mt-1">{details.answerKeysMessage || 'Kunci jawaban dan pembahasan belum dibuka oleh guru.'}</p>
                    <button type="button" onClick={() => void load()} className="mt-2 font-bold underline">Periksa kembali pembahasan</button>
                </div>
            )}

            {/* Tab Content */}
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
                        {pengetahuanAnswers.length === 0 ? (
                            <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
                                <BookOpen className="mx-auto mb-3 text-slate-300" size={36} />
                                <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Tidak ada soal pengetahuan</p>
                            </div>
                        ) : (
                            pengetahuanAnswers.map((answer, index) => (
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
                        {/* Dimension Profile Card */}
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

                        {/* Personality Question Answers */}
                        {kepribadianAnswers.length > 0 && (
                            <div className="space-y-5">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Detail Jawaban Kepribadian</p>
                                {kepribadianAnswers.map((answer, index) => (
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
        </div>
    );
}
