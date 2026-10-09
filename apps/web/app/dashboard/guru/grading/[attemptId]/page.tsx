"use client";
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { QuestionRenderer } from '@/app/components/questions/QuestionRenderer';
import type { Question } from '@/app/types';
import { AttemptGradingDetails,getAttemptDetailsForGrading,parseEssaySubmission,submitEssayGrades } from '@/lib/api/teachers';
import { formatStudentName } from '@/lib/monitoring-health';
import { attachmentLabel,safeExternalUrl } from '@/lib/safe-url';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import { ArrowLeft,CheckCircle2,Hash,Loader2,Save,User } from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function GradeEssayPage() {
    const params = useParams();
    const router = useRouter();
    const attemptId = params.attemptId as string;

    const [loading, setLoading] = useMemoryState('guru_grading__attemptId__loading', true);
    const [submitting, setSubmitting] = useState(false);
    const [details, setDetails] = useState<AttemptGradingDetails | null>(null);
    const [grades, setGrades] = useState<Record<string, number>>({});

    useEffect(() => {
        async function load() {
            setLoading(true);
            const data = await getAttemptDetailsForGrading(attemptId);
            if (data) {
                setDetails(data);
                const initialGrades: Record<string, number> = {};
                data.essayAnswers.forEach((a) => {
                    initialGrades[a.id] = a.score || 0;
                });
                setGrades(initialGrades);
            }
            setLoading(false);
        }
        load();
    }, [attemptId, setLoading]);

    const handleGradeChange = (answerId: string, val: string) => {
        setGrades(prev => ({
            ...prev,
            [answerId]: parseFloat(val) || 0
        }));
    };

    const handleSave = async () => {
        if (!await confirmDialog({
            title: 'Simpan Nilai Uraian?',
            text: 'Simpan nilai uraian? Total nilai akhir akan dihitung kembali dan status ujian akan berubah menjadi Selesai.',
            variant: 'info',
            confirmText: 'Ya, Simpan Nilai',
        })) return;
        setSubmitting(true);
        const res = await submitEssayGrades(attemptId, grades);
        if (res.success) {
            await alertDialog({ title: 'Berhasil', text: 'Berhasil menyimpan nilai!', variant: 'success' });
            router.push('/dashboard/guru/grading');
        } else {
            await alertDialog({ title: 'Gagal Memproses', text: 'Gagal: ' + res.error, variant: 'danger' });
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <Loader2 size={48} className="text-[#3083FF] animate-spin" />
            </div>
        );
    }

    if (!details || details.essayAnswers.length === 0) {
        return (
            <div className="p-10 text-center bg-white border border-slate-100 rounded-[2rem]">
                <p className="text-slate-400 font-bold">Data ujian tidak ditemukan atau tidak ada soal uraian.</p>
                <button onClick={() => router.back()} className="mt-4 text-[#3083FF] font-bold uppercase tracking-widest text-sm hover:underline">
                    Kembali
                </button>
            </div>
        );
    }

    const studentName = formatStudentName(details.attempt.profiles?.full_name, 'Tanpa Nama');
    const examTitle = details.attempt.exams?.title || 'Ujian';

    return (
        <div className="space-y-10 pb-20 animate-in fade-in zoom-in-95 duration-700">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <div>
                    <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-400 hover:text-primary transition-all font-black uppercase tracking-[0.2em] text-[10px] mb-6 group">
                        <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" /> Kembali ke Daftar
                    </button>
                    <h1 className="text-4xl font-black text-[#3083FF] uppercase tracking-tighter mb-3 leading-none">
                        Penilaian Uraian
                    </h1>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2.5 px-4 py-2 bg-primary/10 rounded-xl border border-primary/20">
                            <User size={14} className="text-primary" />
                            <span className="font-semibold text-xs text-primary">{studentName}</span>
                        </div>
                        <span className="text-slate-200">/</span>
                        <div className="flex items-center gap-2 text-slate-500">
                            <CheckCircle2 size={14} />
                            <span className="font-bold text-xs">{examTitle}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                    {details.essayAnswers.some((answer) =>
                        parseEssaySubmission(answer.essay_answer).fileUrls.length > 0
                    ) && (
                        <button
                            onClick={() => router.push(`/dashboard/guru/grading/assignment/${attemptId}`)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold px-6 py-4 rounded-2xl flex items-center gap-3 transition-all border border-indigo-200"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                            <span className="text-[10px] uppercase tracking-widest">Buka Mode Reviewer PDF</span>
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={submitting}
                        className="bg-[#3083FF] hover:bg-[#0a1a6e] text-white font-black px-10 py-5 rounded-2xl flex items-center gap-4 transition-all shadow-2xl shadow-[#3083FF]/20 disabled:opacity-50 tracking-[0.2em] text-[11px] uppercase active:scale-95"
                    >
                        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        Simpan Nilai Uraian
                    </button>
                </div>
            </header>

            <div className="space-y-8">
                {details.essayAnswers.map((answer, index) => {
                    const qInfo = answer.bank_questions;
                    const maxScore = qInfo.score_default || 1;
                    const rendererQuestion: Question = {
                        ...qInfo,
                        metadata: qInfo.metadata ?? undefined,
                        options: (qInfo.options || []).map(option => ({
                            ...option,
                            is_correct: false,
                            weight: 0,
                        })),
                        bank_question_options: (qInfo.options || []).map(option => ({
                            ...option,
                            is_correct: false,
                            weight: 0,
                        })),
                    };

                    return (
                        <motion.div
                            key={answer.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="p-10 bg-white border border-slate-100 rounded-[3rem] shadow-premium relative overflow-hidden group"
                        >
                            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-50/50 blur-[80px] rounded-full -z-10" />

                            <div className="flex justify-between items-center mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-[#3083FF] font-black text-lg border border-slate-100">
                                        {index + 1}
                                    </div>
                                    <div>
                                        <span className="block text-[10px] font-black text-primary uppercase tracking-[0.3em] leading-none mb-1">Soal CBT Uraian</span>
                                        <span className="block text-[8px] font-bold text-slate-300 uppercase tracking-widest">Essay Question Item</span>
                                    </div>
                                </div>
                                <div className="px-5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                        Bobot Maksimal: <span className="text-[#3083FF]">{maxScore}</span> Poin
                                    </span>
                                </div>
                            </div>

                            <div className="mb-10 p-2">
                                <QuestionRenderer
                                    question={rendererQuestion}
                                    answer={parseEssaySubmission(answer.essay_answer).text}
                                    onAnswerChange={() => { }} // Read-only for grading view
                                    // Dulu renderer tampil sebagai form aktif: guru melihat
                                    // textarea & radio topik yang bisa diklik padahal
                                    // perubahannya tidak pernah tersimpan. Di sini renderer
                                    // hanya untuk menampilkan soal — jawabannya sudah punya
                                    // panel sendiri di bawah.
                                    showFeedback
                                    showOptions={false}
                                    isPreview={false}
                                />
                            </div>

                            <div className="bg-slate-50 rounded-[2rem] p-8 border-2 border-slate-100/50 mb-10 relative group/ans">
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center border border-slate-200 shadow-sm">
                                        <User size={14} className="text-slate-400" />
                                    </div>
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Jawaban Siswa</h4>
                                </div>
                                {(() => {
                                    const { text, fileUrls: files, videoUrl } = parseEssaySubmission(answer.essay_answer);

                                    return (
                                        <div className="space-y-6">
                                            <div className="text-lg font-bold text-[#3083FF] leading-relaxed whitespace-pre-wrap pl-1 student-essay-answer">
                                                {text || <span className="text-slate-300 font-medium">Peserta tidak memberikan jawaban pada soal ini.</span>}
                                            </div>

                                            {(files.length > 0 || videoUrl) && (
                                                <div className="pt-6 border-t border-slate-200 space-y-4">
                                                    {files.length > 0 && (
                                                        <div>
                                                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Lampiran File</h5>
                                                            <div className="flex flex-wrap gap-3">
                                                                {files.map((url, i) => (
                                                                    <a key={i} href={safeExternalUrl(url) || undefined} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-[#3083FF] hover:border-primary hover:text-primary transition-colors shadow-sm flex items-center gap-2">
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                                                        {attachmentLabel(url, i)}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {videoUrl && (
                                                        <div>
                                                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Tautan Video</h5>
                                                            {safeExternalUrl(videoUrl) ? (
                                                                <a href={safeExternalUrl(videoUrl)} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-red-600 hover:border-red-500 hover:bg-red-50 transition-colors shadow-sm inline-flex items-center gap-2">
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                                                    Buka Video Lampiran
                                                                </a>
                                                            ) : (
                                                                <p className="text-xs text-slate-500 break-all">{videoUrl} <span className="text-rose-500 font-bold">(tautan tidak valid)</span></p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="flex flex-col md:flex-row items-center gap-8 border-t border-slate-50 pt-10">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-1">Berikan Penilaian</span>
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">Assign Score</span>
                                </div>

                                <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                    <div className="relative group/input flex-1 md:flex-none">
                                        <input
                                            type="number"
                                            min="0"
                                            max={maxScore}
                                            step="0.5"
                                            value={isNaN(grades[answer.id]) ? '' : grades[answer.id]}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                handleGradeChange(answer.id, isNaN(val) ? '0' : val.toString());
                                            }}
                                            className="w-full md:w-40 bg-white border-2 border-slate-100 rounded-2xl px-8 py-5 text-3xl font-black text-primary text-center outline-none focus:border-primary focus:ring-8 focus:ring-primary/5 transition-all shadow-inner group-hover/input:border-slate-200"
                                        />
                                        <div className="absolute -top-3 -right-3 w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center shadow-lg transform rotate-12">
                                            <Hash size={14} strokeWidth={3} />
                                        </div>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-2xl font-black text-slate-200 tracking-tighter">/ {maxScore}</span>
                                        <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">Total Points</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            <div className="flex justify-center pt-12">
                <button
                    onClick={handleSave}
                    disabled={submitting}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-12 py-6 rounded-[2rem] flex items-center gap-5 transition-all shadow-2xl shadow-emerald-500/20 tracking-[0.3em] text-xs uppercase active:scale-95 group"
                >
                    {submitting ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={24} className="transition-transform group-hover:scale-110" />}
                    Finalisasi Penilaian & Update Rapor
                </button>
            </div>
        </div>
    );
}
