"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Loader2, ArrowLeft, Save, User, CheckCircle2,
    Shield, Clock, Calendar, BarChart3, AlertTriangle,
    CheckCircle, XCircle, HelpCircle, Activity,
    Link as LinkIcon, ExternalLink, RotateCcw, MousePointerClick
} from 'lucide-react';
import { getAttemptFullDetailsAction } from '@/lib/api/proctor';
import { submitEssayGrades } from '@/lib/api/teachers';
import { promptRecoveryReason, resetExamAttempt } from '@/lib/api/proctoring';
import { QuestionRenderer } from '@/app/components/questions/QuestionRenderer';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { useMemoryState } from '@/lib/useMemoryState';
import { summarizeAnswerOutcomes } from '@/lib/answer-stats';

export default function AttemptAnalyticsPage() {
    const params = useParams();
    const router = useRouter();
    const attemptId = params.attemptId as string;

    // Key cache HARUS memuat attemptId — key statis membuat detail siswa B
    // menampilkan data siswa A yang ter-cache saat berpindah antar attempt.
    const [loading, setLoading] = useMemoryState(`proktor_monitoring_${attemptId}_loading`, true);
    const [submitting, setSubmitting] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [data, setData] = useMemoryState<any>(`proktor_monitoring_${attemptId}_data`, null);
    const [grades, setGrades] = useState<Record<string, number>>({});
    const [activeTab, setActiveTab] = useState<'questions' | 'security'>('questions');

    useEffect(() => {
        async function load() {
            setLoading(true);
            const res = await getAttemptFullDetailsAction(attemptId);
            if (res) {
                setData(res);
                const initialGrades: Record<string, number> = {};
                res.answers.forEach((a: any) => {
                    if (['essay', 'esay', 'uraian'].includes(a.bank_questions?.type)) {
                        initialGrades[a.id] = a.score || 0;
                    }
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

    const handleResetAttempt = async () => {
        const reason = promptRecoveryReason(studentName);
        if (!reason) return;
        if (!confirm(
            `Yakin ingin mereset ujian siswa "${studentName}"?\n\n` +
            `Siswa akan bisa melanjutkan ujian dengan jawaban yang sudah tersimpan sebelumnya.\n\nAlasan: ${reason}\n\n` +
            `Peringatan: Pastikan perangkat siswa sudah dalam kondisi baik.`
        )) return;

        setResetting(true);
        const res = await resetExamAttempt(attemptId, reason);
        if (res.success) {
            alert(`Ujian "${studentName}" berhasil dipulihkan. ${res.serverAnswerCount} jawaban sudah ada di server.`);
            router.push('/dashboard/proktor/monitoring');
        } else {
            alert('Gagal mereset: ' + res.error);
        }
        setResetting(false);
    };

    const handleSave = async () => {
        if (!confirm('Simpan perubahan nilai? Total nilai akhir akan dihitung kembali.')) return;
        setSubmitting(true);
        const res = await submitEssayGrades(attemptId, grades);
        if (res.success) {
            alert('Berhasil menyimpan nilai!');
            // Reload data
            const updated = await getAttemptFullDetailsAction(attemptId);
            if (updated) setData(updated);
        } else {
            alert('Gagal: ' + res.error);
        }
        setSubmitting(false);
    };

    const stats = useMemo(() => {
        if (!data) return null;
        return summarizeAnswerOutcomes(data.answers);
    }, [data]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 size={48} className="text-[#3083FF] animate-spin" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="py-20 text-center bg-white border border-[#3083FF]/20 rounded-lg shadow-sm">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Data Tidak Ditemukan</h3>
                <p className="text-slate-500 text-sm mb-6">Kami tidak dapat menemukan rekaman pengerjaan untuk ID tersebut.</p>
                <button onClick={() => router.back()} className="px-6 py-2.5 bg-[#3083FF] hover:bg-[#2563EB] text-white rounded-lg text-sm font-semibold transition-all">
                    Kembali Ke Monitoring
                </button>
            </div>
        );
    }

    const { attempt, answers, securityLogs } = data;
    const studentName = attempt.profiles?.full_name || 'Tanpa Nama';
    const examTitle = attempt.exams?.title || 'Ujian';

    return (
        <div className="max-w-7xl mx-auto pb-24">
            {/* Header Area */}
                        {/* Header Area */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs mb-6 px-6 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <button
                        onClick={() => router.back()}
                        className="group flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-all text-xs font-semibold mb-2"
                    >
                        <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" /> Kembali ke Monitor
                    </button>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex flex-wrap items-center gap-2">
                        Detail Analitik <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 rounded text-xs font-mono">ID: {attempt.id.split('-')[0]}</span>
                    </h1>
                    <p className="text-slate-500 text-sm flex flex-wrap items-center gap-2 mt-1">
                        <User size={14} /> {studentName} <span className="mx-1">•</span> <Activity size={14} /> {examTitle}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2.5">
                    {['auto_submitted', 'submitted'].includes(attempt.status) && (
                        <button
                            onClick={handleResetAttempt}
                            disabled={resetting}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-all shadow-xs"
                        >
                            {resetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                            Reset Ujian
                        </button>
                    )}
                    {attempt.needs_manual_grading && (
                        <div className="px-3.5 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <AlertTriangle size={14} /> Menunggu Penilaian Uraian
                        </div>
                    )}
                    {Object.keys(grades).length > 0 && (
                        <button
                            onClick={handleSave}
                            disabled={submitting}
                            className="bg-[#3083FF] hover:bg-[#002d86] text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-xs disabled:opacity-50 text-sm"
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            Simpan Perubahan
                        </button>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Score Card */}
                <div className="bg-white p-5 rounded-lg border border-[#3083FF]/20 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-bold text-slate-500">Nilai Akhir</span>
                        <div className="w-8 h-8 bg-[#3083FF]/10 rounded-lg flex items-center justify-center text-[#3083FF]">
                            <BarChart3 size={16} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-[#3083FF]">
                            {Number(attempt.total_score || 0).toFixed(0)}
                        </span>
                        <span className="text-sm font-semibold text-slate-400">/100</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Number(attempt.total_score || 0)}%` }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                                className="h-full bg-[#3083FF]"
                            />
                        </div>
                        <span className="text-xs font-bold text-[#3083FF]">{Number(attempt.total_score || 0).toFixed(1)}%</span>
                    </div>
                </div>

                {/* Timing Info */}
                <div className="bg-white p-5 rounded-lg border border-[#3083FF]/20 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-sm font-bold text-slate-500">Waktu</span>
                        <div className="w-8 h-8 bg-[#3083FF]/10 rounded-lg flex items-center justify-center text-[#3083FF]">
                            <Clock size={16} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Mulai</span>
                            <span className="font-bold text-slate-700">
                                {attempt.started_at ? new Date(attempt.started_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Selesai</span>
                            <span className="font-bold text-slate-700">
                                {attempt.finished_at ? new Date(attempt.finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Security Shield */}
                <div className="bg-white p-5 rounded-lg border border-[#3083FF]/20 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-bold text-slate-500">Keamanan</span>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${attempt.warning_count > 0 ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-600'}`}>
                            <Shield size={16} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-2xl font-bold text-slate-800">{attempt.warning_count || 0}</span>
                        <span className="text-xs font-semibold text-slate-400">pelanggaran</span>
                    </div>
                    <div className="flex items-center gap-1">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 flex-1 rounded-full ${i < (attempt.warning_count || 0) ? 'bg-red-500' : 'bg-slate-100'}`}
                            />
                        ))}
                    </div>
                </div>

                {/* Answer Summary */}
                <div className="bg-white p-5 rounded-lg border border-[#3083FF]/20 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-sm font-bold text-slate-500">Statistik Jawaban</span>
                        <div className="w-8 h-8 bg-[#3083FF]/10 rounded-lg flex items-center justify-center text-[#3083FF]">
                            <Activity size={16} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                        <div>
                            <p className="text-lg font-bold text-emerald-600 leading-none mb-0.5">{stats?.correct}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-bold">Benar</p>
                        </div>
                        <div>
                            <p className="text-lg font-bold text-red-500 leading-none mb-0.5">{stats?.wrong}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-bold">Salah</p>
                        </div>
                        <div>
                            <p className="text-lg font-bold text-[#3083FF] leading-none mb-0.5">{stats?.essays}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-bold">Esai</p>
                        </div>
                        <div>
                            <p className="text-lg font-bold text-[#3083FF] leading-none mb-0.5">{stats?.total}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-bold">Total</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs */}
            <div className="space-y-4">
                <div className="flex gap-1 bg-white border border-[#3083FF]/30 p-1 rounded-lg w-fit shadow-sm">
                    <button
                        onClick={() => setActiveTab('questions')}
                        className={`relative flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'questions' ? 'bg-[#3083FF] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                    >
                        <BarChart3 size={14} /> Analisis Jawaban
                    </button>
                    <button
                        onClick={() => setActiveTab('security')}
                        className={`relative flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'security' ? 'bg-red-50 text-red-600 shadow-sm border border-red-100' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                    >
                        <Shield size={14} /> Log Keamanan
                        {securityLogs.length > 0 && (
                            <span className="ml-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center animate-pulse">
                                {securityLogs.length}
                            </span>
                        )}
                    </button>
                </div>

                <div className="bg-white border border-[#3083FF]/20 rounded-lg p-6 lg:p-8 shadow-sm">
                    <AnimatePresence mode="wait">
                        {activeTab === 'questions' && (
                            <motion.div key="questions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                                {answers.map((answer: any, index: number) => {
                                    const q = answer.bank_questions;
                                    if (!q) return null;
                                    const isEssay = ['essay', 'esay', 'uraian'].includes(q.type);

                                    return (
                                        <div key={answer.id} className="relative flex gap-4 md:gap-6">
                                            {index < answers.length - 1 && (
                                                <div className="absolute top-10 bottom-0 left-[19px] w-0.5 bg-slate-100 z-0" />
                                            )}

                                            {/* Status Marker */}
                                            <div className="relative z-10 flex flex-col items-center shrink-0">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm transition-all
                                                    ${isEssay
                                                        ? (answer.needs_manual_grading ? 'bg-[#3083FF] text-white' : 'bg-[#3083FF] text-white')
                                                        : (answer.is_correct ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white')
                                                    }`}>
                                                    {isEssay
                                                        ? (answer.needs_manual_grading ? <HelpCircle size={16} /> : <CheckCircle size={16} />)
                                                        : (answer.is_correct ? <CheckCircle size={16} /> : <XCircle size={16} />)
                                                    }
                                                </div>
                                                <span className="mt-2 text-[10px] font-bold text-slate-400">#{index + 1}</span>
                                            </div>

                                            {/* Card Content */}
                                            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-4 md:p-6 hover:border-[#3083FF]/30 transition-colors">
                                                <div className="flex flex-wrap gap-4 justify-between items-center mb-4 pb-4 border-b border-slate-200">
                                                    <div className="flex gap-2">
                                                        <span className="px-2.5 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-500">
                                                            {q.type.toUpperCase()}
                                                        </span>
                                                        <span className="px-2.5 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-500">
                                                            Max: {q.score_default || 1} Pts
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-semibold text-slate-500">Points:</span>
                                                        <span className={`text-lg font-bold ${answer.is_correct ? 'text-emerald-600' : isEssay ? 'text-[#3083FF]' : 'text-red-500'}`}>
                                                            {isEssay ? (Number(grades[answer.id]) || answer.score || 0) : (answer.is_correct ? q.score_default : 0)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="bg-white p-4 rounded border border-slate-200 shadow-sm">
                                                    <QuestionRenderer
                                                        question={q}
                                                        answer={q.type === 'mcq' ? answer.selected_option_id : answer.essay_answer}
                                                        onAnswerChange={() => { }} // Read-only
                                                        showFeedback={true}
                                                    />
                                                </div>

                                                {/* Essay Grading UI */}
                                                {isEssay && (
                                                    <div className="bg-white border-2 border-dashed border-[#3083FF]/40 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                                        <div className="flex items-start sm:items-center gap-3 text-[#3083FF]">
                                                            <div className="w-8 h-8 bg-[#3083FF]/10 rounded flex items-center justify-center shrink-0">
                                                                <BarChart3 size={16} />
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-bold text-slate-800">Penilaian Manual</h4>
                                                                <p className="text-xs text-slate-500">Masukkan poin untuk jawaban esai ini</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max={q.score_default || 1}
                                                                step="0.5"
                                                                value={grades[answer.id] === undefined ? 0 : grades[answer.id]}
                                                                onChange={(e) => handleGradeChange(answer.id, e.target.value)}
                                                                className="w-16 bg-white border border-slate-300 focus:border-[#3083FF] rounded px-2 py-1.5 text-center text-sm font-bold text-slate-800 outline-none"
                                                            />
                                                            <span className="text-slate-400 font-bold text-sm pr-2">/ {q.score_default || 1}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </motion.div>
                        )}

                        {activeTab === 'security' && (
                            <motion.div key="security" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-6">
                                <div className="p-6 bg-red-50 border border-red-100 rounded-lg flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                                    <div className="w-12 h-12 bg-red-500 text-white rounded-lg flex items-center justify-center shadow-lg shadow-red-500/20 shrink-0">
                                        <Shield size={24} />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-lg font-bold text-red-900">Security Audit Trail</h3>
                                        <p className="text-sm text-red-700">Log aktivitas pelanggaran sistem keamanan.</p>
                                    </div>
                                    <div className="sm:ml-auto">
                                        <p className="text-3xl font-black text-red-600 leading-none mb-1">{securityLogs.length}</p>
                                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Total Event</p>
                                    </div>
                                </div>

                                {securityLogs.length === 0 ? (
                                    <div className="py-16 text-center">
                                        <div className="w-16 h-16 bg-emerald-50 border border-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <CheckCircle size={32} />
                                        </div>
                                        <h4 className="text-lg font-bold text-slate-800">Aman Terkendali</h4>
                                        <p className="text-slate-500 text-sm">Tidak ada pelanggaran yang tercatat untuk siswa ini.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {securityLogs.map((log: any) => (
                                            <div key={log.id} className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-lg hover:border-red-300 transition-colors">
                                                <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center text-red-500 shrink-0">
                                                    {log.event_type === 'tab_close' ? <MousePointerClick size={18} /> : <AlertTriangle size={18} />}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-bold text-slate-800 uppercase tracking-tight">{log.event_type.replace('_', ' ')}</p>
                                                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                                                        {new Date(log.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </p>
                                                </div>
                                                {(log.metadata?.duration || log.metadata?.duration_seconds) && (
                                                    <span className="px-3 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded text-xs font-bold whitespace-nowrap">
                                                        Ditutup {log.metadata?.duration || log.metadata?.duration_seconds}s
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Bottom Actions */}
            <div className="mt-8 bg-white border border-[#3083FF]/20 p-6 rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                    <h4 className="text-sm font-bold text-slate-800 mb-1">Aksi Halaman</h4>
                    <p className="text-xs text-slate-500">Pastikan untuk menyimpan jika ada perubahan nilai uraian.</p>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                    <button
                        onClick={() => router.back()}
                        className="flex-1 sm:flex-none px-6 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-semibold transition-all text-sm text-center"
                    >
                        Kembali
                    </button>
                    {Object.keys(grades).length > 0 && (
                        <button
                            onClick={handleSave}
                            disabled={submitting}
                            className="flex-1 sm:flex-none bg-[#3083FF] hover:bg-[#2563EB] text-white font-semibold px-6 py-2.5 rounded-lg transition-all shadow-md active:scale-95 text-sm flex items-center justify-center gap-2"
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            Simpan Perubahan
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
