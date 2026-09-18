"use client";
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getAttemptDetailsForGrading, submitEssayGrades } from '@/lib/api/teachers';
import { Loader2, ArrowLeft, Save, User, CheckCircle2, FileText, ChevronLeft, ChevronRight, MessageSquare, GraduationCap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { safeExternalUrl, attachmentLabel } from '@/lib/safe-url';

export default function AssignmentReviewerPage() {
    const params = useParams();
    const router = useRouter();
    const attemptId = params.attemptId as string;

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [details, setDetails] = useState<any>(null);
    const [grades, setGrades] = useState<Record<string, number>>({});
    const [feedbacks, setFeedbacks] = useState<Record<string, string>>({}); // Future proofing for feedback
    const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);

    useEffect(() => {
        async function load() {
            setLoading(true);
            const data = await getAttemptDetailsForGrading(attemptId);
            if (data && data.essayAnswers.length > 0) {
                // Filter to only get essay answers that have files
                const answersWithFiles = data.essayAnswers.filter((a: any) => {
                    let files: string[] = [];
                    if (typeof a.essay_answer === 'string') {
                        try {
                            const parsed = JSON.parse(a.essay_answer);
                            files = parsed.fileUrls || [];
                        } catch { }
                    } else if (a.essay_answer && typeof a.essay_answer === 'object') {
                        files = (a.essay_answer as any).fileUrls || [];
                    }
                    return files.length > 0;
                });
                
                // If there are answers with files, prioritize them. Otherwise just use all essays.
                const relevantAnswers = answersWithFiles.length > 0 ? answersWithFiles : data.essayAnswers;
                data.essayAnswers = relevantAnswers;

                setDetails(data);
                const initialGrades: Record<string, number> = {};
                relevantAnswers.forEach((a: any) => {
                    initialGrades[a.id] = a.score || 0;
                });
                setGrades(initialGrades);
            }
            setLoading(false);
        }
        load();
    }, [attemptId]);

    const handleGradeChange = (answerId: string, val: string) => {
        setGrades(prev => ({
            ...prev,
            [answerId]: parseFloat(val) || 0
        }));
    };

    const handleSave = async () => {
        if (!confirm('Simpan nilai? Ujian akan diselesaikan secara sistem jika semua soal telah ternilai.')) return;
        setSubmitting(true);
        const res = await submitEssayGrades(attemptId, grades);
        if (res.success) {
            alert('Berhasil menyimpan nilai!');
            router.push('/dashboard/guru/grading');
        } else {
            alert('Gagal: ' + res.error);
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-slate-900">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={48} className="text-primary animate-spin" />
                    <p className="text-slate-400 font-medium">Memuat Workspace Penilaian...</p>
                </div>
            </div>
        );
    }

    if (!details || details.essayAnswers.length === 0) {
        return (
            <div className="flex justify-center items-center h-screen bg-slate-900">
                <div className="text-center p-10 bg-slate-800 rounded-3xl border border-slate-700 max-w-md">
                    <FileText size={48} className="text-slate-500 mx-auto mb-4" />
                    <p className="text-slate-300 font-bold mb-6">Tidak ada lampiran tugas yang ditemukan untuk ujian ini.</p>
                    <button onClick={() => router.back()} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all">
                        Kembali ke Penilaian Reguler
                    </button>
                </div>
            </div>
        );
    }

    const currentAnswer = details.essayAnswers[currentQuestionIdx];
    const qInfo = currentAnswer.bank_questions;
    const maxScore = qInfo.score_default || 1;
    
    // Parse the answer
    let text = currentAnswer.essay_answer || '';
    let files: string[] = [];
    let videoUrl = '';
    let topicId = '';
    if (typeof text === 'string') {
        try {
            const parsed = JSON.parse(text);
            if (parsed.text !== undefined || parsed.fileUrls !== undefined) {
                text = parsed.text || '';
                files = parsed.fileUrls || [];
                videoUrl = parsed.videoUrl || '';
                topicId = parsed.topicId || '';
            }
        } catch { }
    } else if (text && typeof text === 'object') {
        const obj: any = text;
        text = obj.text || '';
        files = obj.fileUrls || [];
        videoUrl = obj.videoUrl || '';
        topicId = obj.topicId || '';
    }

    // Determine the active file to preview.
    // Isi fileUrls berasal dari payload jawaban milik siswa, jadi tidak boleh
    // langsung dipasang ke href/src/iframe tanpa pengecekan skema.
    const activeFileRaw = files.length > 0 ? files[0] : null;
    const activeFile = activeFileRaw ? safeExternalUrl(activeFileRaw) : '';
    const safeVideoUrl = safeExternalUrl(videoUrl);
    const isPdf = activeFile.toLowerCase().split('?')[0].endsWith('.pdf');
    
    // Attempt details
    /* @ts-ignore */
    const studentName = details.attempt.profiles?.full_name || 'Tanpa Nama';
    /* @ts-ignore */
    const examTitle = details.attempt.exams?.title || 'Tugas / Ujian';
    /* @ts-ignore */
    const submittedAt = details.attempt.finished_at ? new Date(details.attempt.finished_at).toLocaleString('id-ID') : 'Belum Selesai';

    return (
        <div className="h-screen w-full bg-[#0f172a] text-slate-200 overflow-hidden flex flex-col font-sans">
            {/* Top Navigation */}
            <header className="h-16 shrink-0 border-b border-slate-800 bg-[#1e293b]/50 backdrop-blur-md flex items-center justify-between px-6 z-10">
                <div className="flex items-center gap-6">
                    <button onClick={() => router.back()} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="h-6 w-px bg-slate-700" />
                    <div>
                        <h1 className="text-sm font-bold text-white leading-tight">{examTitle}</h1>
                        <p className="text-xs text-slate-400">Workspace Penilaian Reviewer</p>
                    </div>
                </div>

                {details.essayAnswers.length > 1 && (
                    <div className="flex items-center gap-4 bg-slate-800/50 rounded-lg p-1 border border-slate-700">
                        <button 
                            disabled={currentQuestionIdx === 0}
                            onClick={() => setCurrentQuestionIdx(prev => prev - 1)}
                            className="p-1.5 rounded-md hover:bg-slate-700 disabled:opacity-30 transition-colors"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className="text-xs font-medium px-2">
                            Soal {currentQuestionIdx + 1} / {details.essayAnswers.length}
                        </span>
                        <button 
                            disabled={currentQuestionIdx === details.essayAnswers.length - 1}
                            onClick={() => setCurrentQuestionIdx(prev => prev + 1)}
                            className="p-1.5 rounded-md hover:bg-slate-700 disabled:opacity-30 transition-colors"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}
            </header>

            {/* Main Content Split */}
            <main className="flex-1 flex overflow-hidden">
                {/* Left Side: Document Viewer */}
                <div className="flex-1 flex flex-col relative bg-[#0B1121]">
                    <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-center pointer-events-none">
                        <div className="bg-slate-900/80 backdrop-blur pointer-events-auto border border-slate-700 rounded-lg px-4 py-2 flex items-center gap-3">
                            <FileText size={16} className="text-blue-400" />
                            <span className="text-sm font-medium">
                                {activeFileRaw ? attachmentLabel(activeFileRaw, 0) : 'Tidak ada lampiran'}
                            </span>
                        </div>
                        {activeFile && (
                            <a href={activeFile} target="_blank" rel="noopener noreferrer" className="bg-blue-600/90 hover:bg-blue-500 backdrop-blur pointer-events-auto text-white rounded-lg px-4 py-2 text-xs font-bold transition-colors shadow-lg flex items-center gap-2">
                                Buka di Tab Baru
                            </a>
                        )}
                    </div>

                    <div className="flex-1 p-4 pt-16 h-full">
                        {activeFile ? (
                            <div className="w-full h-full bg-white rounded-xl overflow-hidden shadow-2xl border border-slate-700/50 relative">
                                {isPdf ? (
                                    <iframe src={`${activeFile}#view=FitH`} className="w-full h-full border-0" title="PDF Viewer" />
                                ) : (
                                    <div className="w-full h-full overflow-auto flex items-center justify-center bg-slate-100 p-8">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={activeFile} alt="Lampiran Tugas" className="max-w-full max-h-full object-contain drop-shadow-xl" />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="w-full h-full rounded-xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 bg-slate-800/30">
                                <FileText size={48} className="mb-4 opacity-50" />
                                <p className="font-medium">Siswa tidak melampirkan file.</p>
                                {safeVideoUrl && (
                                    <a href={safeVideoUrl} target="_blank" rel="noopener noreferrer" className="mt-4 px-6 py-3 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30 rounded-xl transition-colors font-bold text-sm">
                                        Lihat Tautan Video
                                    </a>
                                )}
                                {videoUrl && !safeVideoUrl && (
                                    <p className="mt-4 text-xs text-slate-400 break-all max-w-sm text-center">
                                        {videoUrl} <span className="text-rose-400 font-bold">(tautan tidak valid)</span>
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Side: Grading Panel */}
                <div className="w-[400px] shrink-0 border-l border-slate-800 bg-[#1e293b] flex flex-col">
                    <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                        
                        {/* Student Info Card */}
                        <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[40px] rounded-full" />
                            <div className="flex items-center gap-4 relative z-10">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 p-0.5">
                                    <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                                        <User size={20} className="text-blue-400" />
                                    </div>
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-white">{studentName}</h2>
                                    <p className="text-xs text-slate-400 mt-0.5">Disubmit: {submittedAt}</p>
                                </div>
                            </div>
                        </div>

                        {/* Assignment Details (Topics) */}
                        {topicId && qInfo.metadata?.is_multi_topic && (
                            <div>
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Topik Terpilih</h3>
                                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                                    <p className="text-sm text-indigo-300 font-medium">
                                        {(() => {
                                            const options = qInfo.options || [];
                                            const opt = options.find((o: any) => o.id === topicId);
                                            return opt ? (opt.option_text || opt.text) : 'Topik Tidak Diketahui';
                                        })()}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Essay Text Answer */}
                        {text && (
                            <div>
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Jawaban Teks</h3>
                                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 max-h-48 overflow-y-auto custom-scrollbar">
                                    <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{text}</p>
                                </div>
                            </div>
                        )}

                        {/* Grading Inputs */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <GraduationCap size={16} /> Panel Penilaian
                            </h3>
                            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl">
                                <div className="flex justify-between items-center mb-6">
                                    <span className="text-sm font-medium text-slate-300">Nilai Akhir</span>
                                    <span className="text-xs font-bold text-slate-500 bg-slate-900 px-3 py-1 rounded-full border border-slate-700">Maks: {maxScore}</span>
                                </div>
                                
                                <div className="flex items-end gap-3 group">
                                    <div className="relative flex-1">
                                        <input 
                                            type="number"
                                            min="0"
                                            max={maxScore}
                                            step="0.5"
                                            value={isNaN(grades[currentAnswer.id]) ? '' : grades[currentAnswer.id]}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                handleGradeChange(currentAnswer.id, isNaN(val) ? '0' : val.toString());
                                            }}
                                            className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl px-4 py-4 text-3xl font-black text-white text-center outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all"
                                        />
                                    </div>
                                    <span className="text-xl font-bold text-slate-500 pb-4">/ {maxScore}</span>
                                </div>

                                {/* Custom Slider for intuitive grading */}
                                <div className="mt-6">
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max={maxScore} 
                                        step="0.5"
                                        value={isNaN(grades[currentAnswer.id]) ? 0 : grades[currentAnswer.id]}
                                        onChange={(e) => {
                                            handleGradeChange(currentAnswer.id, e.target.value);
                                        }}
                                        className="w-full accent-blue-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <div className="flex justify-between text-xs font-medium text-slate-500 mt-2">
                                        <span>0</span>
                                        <span>{maxScore / 2}</span>
                                        <span>{maxScore}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Overall Feedback */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <MessageSquare size={16} /> Catatan Guru
                            </h3>
                            <textarea 
                                placeholder="Berikan umpan balik atau komentar untuk siswa (Opsional)..."
                                className="w-full h-32 bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm text-slate-300 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none placeholder:text-slate-600"
                            ></textarea>
                        </div>

                    </div>

                    {/* Bottom Action */}
                    <div className="p-6 border-t border-slate-800 bg-[#1e293b] shrink-0">
                        <button
                            onClick={handleSave}
                            disabled={submitting}
                            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50"
                        >
                            {submitting ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                            Simpan Nilai & Publikasikan
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
