"use client";
import { InlineMath } from '@/app/components/questions/InlineMath';
import { getExamAnswersForAnalysisAction,getExamAttemptsAction,listOrganizationExams } from '@/lib/api/proctor';
import { getGuruOrganization } from '@/lib/api/teachers';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import { AlertTriangle,BarChart3,Calculator,FileSpreadsheet,Loader2,RefreshCw,Users } from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useEffect,useState } from 'react';

function GradingContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('guru_grading_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<any[]>('guru_grading_exams', []);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);

    const [attempts, setAttempts] = useMemoryState<any[]>('guru_grading_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<any[]>('guru_grading_analysis', []);

    const [activeTab, setActiveTab] = useState<'results' | 'analysis'>('results');

    const loadInitialData = async () => {
        setIsLoading(true);
        const user = await getSessionUser();
        if (user) {
            const org = await getGuruOrganization();
            if (org) {
                const examList = await listOrganizationExams();
                setExams(examList);
                if (!initialExamId && examList.length > 0) {
                    setSelectedExamId(examList[0].id);
                }
            }
        }
        setIsLoading(false);
    };

    const loadExamData = async (examId: string) => {
        setIsRefreshing(true);
        try {
            const [attData, analysisData] = await Promise.all([
                getExamAttemptsAction(examId),
                getExamAnswersForAnalysisAction(examId)
            ]);

            setAttempts(attData);

            // Calculate Item Analysis — action mengembalikan { questions, answers }:
            // semua soal bank (bernomor) + jawaban ternilai (is_correct null =
            // belum ternilai/esai, tidak dihitung salah).
            const { questions: bankQuestions, answers: ansRows } = analysisData;
            const itemStats: Record<string, { total: number, correct: number, incorrect: number }> = {};

            (ansRows || []).forEach((ans: any) => {
                const qId = ans.question_id;
                if (!itemStats[qId]) itemStats[qId] = { total: 0, correct: 0, incorrect: 0 };
                itemStats[qId].total += 1;
                if (ans.is_correct === true) itemStats[qId].correct += 1;
                else if (ans.is_correct === false) itemStats[qId].incorrect += 1;
            });

            const analysisArray = ((bankQuestions || []) as any[]).map((q: any) => {
                const stat = itemStats[q.id] || { total: 0, correct: 0, incorrect: 0 };
                const graded = stat.correct + stat.incorrect;
                return {
                    id: q.id,
                    number: q.number,
                    qText: q.question_text || 'Deskripsi Soal Tidak Terbaca',
                    total: stat.total,
                    correct: stat.correct,
                    incorrect: stat.incorrect,
                    incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0
                };
            }).sort((a: any, b: any) => (b.incorrectPercentage - a.incorrectPercentage) || (a.number - b.number));

            setAnalysis(analysisArray);

        } catch (error) {
            console.error(error);
        }
        setIsRefreshing(false);
    };

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (selectedExamId) {
            loadExamData(selectedExamId);
        } else {
            setAttempts([]);
            setAnalysis([]);
        }
    }, [selectedExamId]);

    const formatUTCDateTime = (str: string) => {
        const date = new Date(str.match(/(Z|[+-]\d{2}:\d{2})$/) ? str : str + 'Z');
        if (isNaN(date.getTime())) return '-';
        const day = String(date.getUTCDate()).padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const month = months[date.getUTCMonth()];
        const h = String(date.getUTCHours()).padStart(2, '0');
        const m = String(date.getUTCMinutes()).padStart(2, '0');
        return `${day} ${month} ${h}:${m}`;
    };

    const handleRefresh = () => {
        if (selectedExamId) loadExamData(selectedExamId);
    };

    const exportResultsToExcel = async () => {
        if (!attempts || attempts.length === 0) return alert('Tidak ada data untuk diekspor');
        const XLSX = await import('xlsx');

        const dataToExport = attempts.map(a => ({
            'Nama Siswa': a.profiles?.full_name || '-',
            'Email': a.profiles?.email || '-',
            'Status': a.status === 'submitted' ? 'Selesai' : a.status,
            'Nilai Akhir': Number(a.total_score).toFixed(2),
            'Waktu Mulai': a.started_at ? new Date(a.started_at).toLocaleString('id-ID') : '-',
            'Waktu Selesai': a.finished_at ? new Date(a.finished_at).toLocaleString('id-ID') : '-'
        }));

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Hasil Ujian");
        ws['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 20 }];

        XLSX.writeFile(wb, `Hasil_Ujian_${selectedExamId.slice(0, 5)}.xlsx`);
    };

    const exportAnalysisToExcel = async () => {
        if (!analysis || analysis.length === 0) return alert('Tidak ada data untuk diekspor');
        const XLSX = await import('xlsx');

        const dataToExport = analysis.map((a, index) => {
            const plainText = a.qText.replace(/<[^>]+>/g, '');
            return {
                'No': index + 1,
                'Potongan Soal': plainText.length > 50 ? plainText.substring(0, 50) + '...' : plainText,
                'Total Menjawab': a.total,
                'Menjawab Benar': a.correct,
                'Menjawab Salah': a.incorrect,
                'Persentase Salah (%)': a.incorrectPercentage.toFixed(2) + '%'
            };
        });

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Analisis Soal");
        ws['!cols'] = [{ wch: 5 }, { wch: 50 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];

        XLSX.writeFile(wb, `Analisis_Soal_${selectedExamId.slice(0, 5)}.xlsx`);
    };

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 size={48} className="text-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-20 animate-in fade-in duration-700">
                        {/* Exam Selector Toolbar */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center">
                        <BarChart3 size={20} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800">Laporan & Penilaian Ujian</h2>
                        <p className="text-xs text-slate-400">Pilih ujian untuk melihat rekap nilai dan analisis butir soal</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <select
                        value={selectedExamId}
                        onChange={(e) => setSelectedExamId(e.target.value)}
                        className="flex-1 sm:w-72 bg-slate-50 border border-slate-200 text-slate-800 focus:ring-2 focus:ring-[#3083FF] outline-none px-3.5 py-2.5 rounded-xl text-xs font-semibold"
                    >
                        <option value="">-- Pilih Ujian --</option>
                        {exams.map(exam => (
                            <option key={exam.id} value={exam.id}>{exam.title}</option>
                        ))}
                    </select>

                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing || !selectedExamId}
                        className="p-2.5 border border-slate-200 rounded-xl text-slate-600 hover:text-[#3083FF] hover:bg-slate-50 transition-all disabled:opacity-50"
                        title="Segarkan Data"
                    >
                        <RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {!selectedExamId ? (
                <div className="py-20 text-center bg-white border border-slate-100 rounded-[2rem]">
                    <BarChart3 size={48} className="text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-tighter">Pilih ujian di atas untuk melihat rapor</p>
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="flex border-b border-slate-200">
                        <button
                            onClick={() => setActiveTab('results')}
                            className={`px-8 py-4 font-black uppercase tracking-widest text-[11px] transition-all flex border-b-2 items-center gap-2 ${activeTab === 'results' ? 'border-[#3083FF] text-[#3083FF]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                        >
                            <Users size={16} /> REKAP HASIL SISWA
                        </button>
                        <button
                            onClick={() => setActiveTab('analysis')}
                            className={`px-8 py-4 font-black uppercase tracking-widest text-[11px] transition-all flex border-b-2 items-center gap-2 ${activeTab === 'analysis' ? 'border-amber-500 text-amber-500' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                        >
                            <Calculator size={16} /> ANALISIS BUTIR SOAL
                        </button>
                    </div>

                    <div className="relative min-h-[400px]">
                        {isRefreshing && (
                            <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center rounded-2xl">
                                <Loader2 size={32} className="text-[#3083FF] animate-spin" />
                            </div>
                        )}

                        <AnimatePresence mode="wait">
                            {/* TAB RESULTS */}
                            {activeTab === 'results' && (
                                <motion.div key="results" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                                        <h3 className="font-bold text-slate-700">Daftar Pengumpulan</h3>
                                        <button onClick={exportResultsToExcel} className="flex items-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all">
                                            <FileSpreadsheet size={16} /> EXPORT EXCEL
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400">
                                                    <th className="p-4 border-b border-slate-100 font-black">Nama Siswa</th>
                                                    <th className="p-4 border-b border-slate-100 font-black">Status</th>
                                                    <th className="p-4 border-b border-slate-100 font-black">Mulai</th>
                                                    <th className="p-4 border-b border-slate-100 font-black">Selesai</th>
                                                    <th className="p-4 border-b border-slate-100 font-black text-right">Nilai</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {attempts.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="p-8 text-center text-slate-400 font-medium">Belum ada siswa yang mengerjakan ujian ini.</td>
                                                    </tr>
                                                ) : (
                                                    attempts.map((att) => (
                                                        <tr
                                                            key={att.id}
                                                            onClick={() => router.push(`/dashboard/guru/grading/${att.id}`)}
                                                            className="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0 cursor-pointer"
                                                        >
                                                            <td className="p-4 font-bold text-slate-700">{att.profiles?.full_name || 'Tanpa Nama'}</td>
                                                            <td className="p-4">
                                                                <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${att.status === 'submitted' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                                                                    {att.status === 'submitted' ? 'SELESAI' : att.status}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-xs font-medium text-slate-500">{att.started_at ? formatUTCDateTime(att.started_at) : '-'}</td>
                                                            <td className="p-4 text-xs font-medium text-slate-500">{att.finished_at ? formatUTCDateTime(att.finished_at) : '-'}</td>
                                                            <td className="p-4 text-right">
                                                                {att.needs_manual_grading ? (
                                                                    <span className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-500 border border-amber-100">
                                                                        BELUM DINILAI
                                                                    </span>
                                                                ) : (
                                                                    <span className="font-black text-[#3083FF] text-lg">{Number(att.total_score).toFixed(0)}</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            )}

                            {/* TAB ANALYSIS */}
                            {activeTab === 'analysis' && (
                                <motion.div key="analysis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                                        <h3 className="font-bold text-slate-700">Tingkat Kesulitan Soal</h3>
                                        <button onClick={exportAnalysisToExcel} className="flex items-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all">
                                            <FileSpreadsheet size={16} /> EXPORT EXCEL
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400">
                                                    <th className="p-4 border-b border-slate-100 font-black">Potongan Soal</th>
                                                    <th className="p-4 border-b border-slate-100 font-black text-center">Menjawab</th>
                                                    <th className="p-4 border-b border-slate-100 font-black text-center">Benar</th>
                                                    <th className="p-4 border-b border-slate-100 font-black text-center">Salah</th>
                                                    <th className="p-4 border-b border-slate-100 font-black text-right">% Kesalahan</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analysis.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="p-8 text-center text-slate-400 font-medium">Belum ada data analisis. Pastikan ujian sudah dikerjakan siswa.</td>
                                                    </tr>
                                                ) : (
                                                    analysis.map((anl) => {
                                                        const isCritical = anl.incorrectPercentage > 50;

                                                        // bersihkan HTML tag utk preview

                                                        return (
                                                            <tr key={anl.id} className={`hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0 ${isCritical ? 'bg-rose-50/20' : ''}`}>
                                                                <td className="p-4">
                                                                    <div className="flex items-start gap-2">
                                                                        {isCritical && <AlertTriangle size={14} className="text-rose-500 mt-1 flex-shrink-0" />}
                                                                        <span className={`text-sm ${isCritical ? 'font-bold text-rose-700' : 'font-medium text-slate-600'}`}>
                                                                            <div className="line-clamp-2"><InlineMath text={anl.qText} /></div>
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="p-4 text-center text-slate-500 font-bold">{anl.total}</td>
                                                                <td className="p-4 text-center text-emerald-600 font-bold bg-emerald-50/30">{anl.correct}</td>
                                                                <td className="p-4 text-center text-rose-500 font-bold bg-rose-50/30">{anl.incorrect}</td>
                                                                <td className="p-4 text-right">
                                                                    <div className="flex flex-col items-end">
                                                                        <span className={`font-black text-lg ${isCritical ? 'text-rose-600' : 'text-slate-700'}`}>
                                                                            {anl.incorrectPercentage.toFixed(0)}%
                                                                        </span>
                                                                        <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                                            <div className={`h-full ${isCritical ? 'bg-rose-500' : 'bg-primary'}`} style={{ width: `${anl.incorrectPercentage}%` }}></div>
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
                                    {analysis.length > 0 && (
                                        <div className="p-4 bg-amber-50 border-t border-amber-100 text-[10px] text-amber-700 font-bold uppercase tracking-widest flex items-center gap-2">
                                            <AlertTriangle size={14} /> Tanda peringatan merah menunjukkan persentase jawaban salah {">"} 50%
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </>
            )}
        </div>
    );
}

export default function GradingPage() {
    return (
        <Suspense fallback={
            <div className="flex justify-center py-20">
                <Loader2 size={48} className="text-[#3083FF] animate-spin" />
            </div>
        }>
            <GradingContent />
        </Suspense>
    );
}
