"use client";
import { getAssignmentSubmissionsAction,gradeAssignmentAction } from '@/lib/api/proctor';
import type { AssignmentSubmission as Submission,OrganizationExam } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertCircle,
ArrowLeft,
BookOpen,
CheckCircle2,
ChevronDown,ChevronUp,
Clock,
Download,
ExternalLink,
FileText,
Loader2,
RefreshCw,
Save,
Search,
Star,
Users
} from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useState } from 'react';

export default function AssignmentReviewPage() {
    const params = useParams();
    const router = useRouter();
    const examId = params.examId as string;

    const [isLoading, setIsLoading] = useState(true);
    const [exam, setExam] = useState<OrganizationExam | null>(null);
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'belum_mulai' | 'sudah_kumpul' | 'belum_dinilai'>('all');
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [gradingData, setGradingData] = useState<Record<string, { score: string; feedback: string }>>({});
    const [savingAttemptId, setSavingAttemptId] = useState<string | null>(null);
    const [savedAttemptIds, setSavedAttemptIds] = useState<Set<string>>(new Set());

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const result = await getAssignmentSubmissionsAction(examId);
        if (result.success) {
            setExam(result.exam);
            setSubmissions(result.submissions);
            // Pre-fill grading data from existing values
            const initial: Record<string, { score: string; feedback: string }> = {};
            result.submissions.forEach((s) => {
                if (s.attemptId) {
                    initial[s.attemptId] = {
                        score: s.teacherScore !== null ? String(s.teacherScore) : '',
                        feedback: s.teacherFeedback || '',
                    };
                }
            });
            setGradingData(initial);
        }
        setIsLoading(false);
    }, [examId]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    const handleSaveGrade = async (submission: Submission) => {
        if (!submission.attemptId) return;
        const data = gradingData[submission.attemptId];
        if (!data) return;
        const score = parseFloat(data.score);
        if (isNaN(score) || score < 0 || score > 100) {
            alert('Nilai harus antara 0 dan 100.');
            return;
        }
        setSavingAttemptId(submission.attemptId);
        const result = await gradeAssignmentAction(submission.attemptId, score, data.feedback, submission.submittedAt || '');
        if (result.success) {
            setSavedAttemptIds(prev => new Set(prev).add(submission.attemptId!));
            // Update local state
            setSubmissions(prev => prev.map(s =>
                s.attemptId === submission.attemptId
                    ? { ...s, teacherScore: score, teacherFeedback: data.feedback, needsGrading: false, score }
                    : s
            ));
        } else {
            alert('Gagal menyimpan nilai: ' + result.error);
        }
        setSavingAttemptId(null);
    };

    const getStatusBadge = (s: Submission) => {
        if (s.status === 'belum_mulai') {
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500"><Clock size={10} />Belum Mulai</span>;
        }
        if (s.status === 'sedang_dikerjakan') {
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-600"><Loader2 size={10} className="animate-spin" />Sedang Dikerjakan</span>;
        }
        if (s.needsGrading || s.teacherScore === null) {
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700"><AlertCircle size={10} />Belum Dinilai</span>;
        }
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700"><CheckCircle2 size={10} />Sudah Dinilai</span>;
    };

    const filteredSubmissions = submissions.filter(s => {
        const matchSearch = s.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.identityNumber.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchSearch) return false;
        if (filterStatus === 'all') return true;
        if (filterStatus === 'belum_mulai') return s.status === 'belum_mulai';
        if (filterStatus === 'sudah_kumpul') return s.status === 'sudah_kumpul';
        if (filterStatus === 'belum_dinilai') return s.status === 'sudah_kumpul' && (s.needsGrading || s.teacherScore === null);
        return true;
    });

    const stats = {
        total: submissions.length,
        submitted: submissions.filter(s => s.status === 'sudah_kumpul').length,
        graded: submissions.filter(s => s.status === 'sudah_kumpul' && s.teacherScore !== null && !s.needsGrading).length,
        pending: submissions.filter(s => s.status === 'sudah_kumpul' && (s.needsGrading || s.teacherScore === null)).length,
    };

    const formatDate = (d: string | null) => {
        if (!d) return '-';
        return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const getFileIcon = (url: string) => {
        const ext = url.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return '🖼️';
        if (ext === 'pdf') return '📄';
        if (['doc', 'docx'].includes(ext || '')) return '📝';
        if (['xls', 'xlsx'].includes(ext || '')) return '📊';
        if (['ppt', 'pptx'].includes(ext || '')) return '📽️';
        if (ext === 'zip') return '🗜️';
        return '📎';
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 size={32} className="animate-spin text-[#3083FF]" />
                    <p className="text-slate-500 text-sm">Memuat data tugas...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.back()}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center border border-amber-200">
                                <FileText size={18} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-slate-900">{exam?.title || 'Review Tugas'}</h1>
                                <p className="text-xs text-slate-500">Kelola dan nilai pengumpulan tugas siswa</p>
                            </div>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                onClick={loadData}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                                title="Refresh"
                            >
                                <RefreshCw size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

                {/* Stats Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                        { label: 'Total Siswa', value: stats.total, color: 'bg-slate-100 text-slate-700', icon: Users },
                        { label: 'Sudah Kumpul', value: stats.submitted, color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
                        { label: 'Belum Dinilai', value: stats.pending, color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
                        { label: 'Sudah Dinilai', value: stats.graded, color: 'bg-blue-100 text-blue-700', icon: Star },
                    ].map(stat => (
                        <div key={stat.label} className={`${stat.color} rounded-2xl p-4 flex items-center gap-3`}>
                            <stat.icon size={20} />
                            <div>
                                <div className="text-2xl font-black">{stat.value}</div>
                                <div className="text-xs font-medium opacity-80">{stat.label}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Instruksi Tugas */}
                {exam?.metadata?.assignment_description && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <BookOpen size={16} className="text-amber-600" />
                            <h3 className="text-sm font-semibold text-amber-800">Instruksi Tugas</h3>
                        </div>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{exam.metadata.assignment_description}</p>
                        {exam.end_time && (
                            <p className="text-xs text-amber-600 mt-2 font-medium">⏰ Batas pengumpulan: {formatDate(exam.end_time)}</p>
                        )}
                    </div>
                )}

                {/* Filters & Search */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Cari nama atau NIS..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#3083FF]/20 outline-none bg-white"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {[
                            { id: 'all', label: 'Semua' },
                            { id: 'belum_mulai', label: 'Belum Mulai' },
                            { id: 'sudah_kumpul', label: 'Sudah Kumpul' },
                            { id: 'belum_dinilai', label: 'Belum Dinilai' },
                        ].map(f => (
                            <button
                                key={f.id}
                                onClick={() => setFilterStatus(f.id as typeof filterStatus)}
                                className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${filterStatus === f.id
                                    ? 'bg-[#3083FF] text-white border-[#3083FF]'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-[#3083FF]/30'
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Submissions Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Siswa</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">NIS</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Dikumpulkan</th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">File</th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Nilai</th>
                                    <th className="px-4 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredSubmissions.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="text-center py-12 text-slate-400">
                                            <FileText size={32} className="mx-auto mb-2 opacity-30" />
                                            <p>Tidak ada data yang ditemukan</p>
                                        </td>
                                    </tr>
                                ) : filteredSubmissions.map(s => (
                                    <React.Fragment key={s.userId}>
                                        <tr
                                            className={`hover:bg-slate-50 transition-colors cursor-pointer ${expandedRow === s.userId ? 'bg-amber-50/50' : ''}`}
                                            onClick={() => setExpandedRow(prev => prev === s.userId ? null : s.userId)}
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center text-xs font-bold shrink-0">
                                                        {s.fullName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-xs font-medium text-slate-900 truncate max-w-[160px]">{formatStudentName(s.fullName, 'Tanpa Nama')}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{s.identityNumber}</td>
                                            <td className="px-4 py-3">{getStatusBadge(s)}</td>
                                            <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{formatDate(s.submittedAt)}</td>
                                            <td className="px-4 py-3">
                                                {s.fileUrls.length > 0 ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                                                        <Download size={12} />
                                                        {s.fileUrls.length} file
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-slate-300">-</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {s.teacherScore !== null ? (
                                                    <span className={`font-semibold text-xs ${s.teacherScore >= 75 ? 'text-emerald-600' : s.teacherScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                                                        {s.teacherScore}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 text-sm">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-slate-400">
                                                {expandedRow === s.userId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            </td>
                                        </tr>

                                        {/* Expanded row: grading panel */}
                                        <AnimatePresence>
                                            {expandedRow === s.userId && (
                                                <tr>
                                                    <td colSpan={7} className="bg-amber-50/40 border-b border-amber-100">
                                                        <motion.div
                                                            initial={{ opacity: 0, height: 0 }}
                                                            animate={{ opacity: 1, height: 'auto' }}
                                                            exit={{ opacity: 0, height: 0 }}
                                                            className="px-4 py-4 overflow-hidden"
                                                        >
                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                                {/* Left: Submission Details */}
                                                                <div className="space-y-4">
                                                                    <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Hasil Pengumpulan</h4>

                                                                    {/* Files */}
                                                                    {s.fileUrls.length > 0 ? (
                                                                        <div>
                                                                            <p className="text-xs font-medium text-slate-500 mb-2">File yang Dikumpulkan:</p>
                                                                            <div className="flex flex-col gap-2">
                                                                                {s.fileUrls.map((url, i) => {
                                                                                    const filename = decodeURIComponent(url.split('/').pop() || `File ${i + 1}`);
                                                                                    return (
                                                                                        <a
                                                                                            key={i}
                                                                                            href={url}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                                                                                        >
                                                                                            <span className="text-xl">{getFileIcon(url)}</span>
                                                                                            <span className="text-xs text-slate-700 flex-1 truncate font-medium">{filename}</span>
                                                                                            <ExternalLink size={12} className="text-slate-300 group-hover:text-blue-500 shrink-0" />
                                                                                        </a>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-center py-6 bg-white rounded-xl border border-dashed border-slate-200">
                                                                            <FileText size={24} className="mx-auto mb-1 text-slate-300" />
                                                                            <p className="text-xs text-slate-400">Tidak ada file yang dikumpulkan</p>
                                                                        </div>
                                                                    )}

                                                                    {/* Text submission */}
                                                                    {s.textSubmission && (
                                                                        <div>
                                                                            <p className="text-xs font-medium text-slate-500 mb-2">Catatan Siswa:</p>
                                                                            <div className="p-3 bg-white rounded-xl border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap">
                                                                                {s.textSubmission}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Right: Grading Form */}
                                                                {s.attemptId ? (
                                                                    <div className="space-y-4">
                                                                        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Penilaian Guru</h4>

                                                                        {/* Score input */}
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-slate-700 mb-1.5">Nilai (0 – 100)</label>
                                                                            <div className="flex items-center gap-3">
                                                                                <input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    max="100"
                                                                                    step="0.5"
                                                                                    placeholder="0"
                                                                                    value={gradingData[s.attemptId]?.score ?? ''}
                                                                                    onChange={e => setGradingData(prev => ({
                                                                                        ...prev,
                                                                                        [s.attemptId!]: { ...prev[s.attemptId!], score: e.target.value }
                                                                                    }))}
                                                                                    className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-center text-lg font-bold focus:ring-2 focus:ring-amber-400/50 outline-none"
                                                                                />
                                                                                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                                                                    <div
                                                                                        className={`h-full rounded-full transition-all ${parseFloat(gradingData[s.attemptId]?.score || '0') >= 75 ? 'bg-emerald-500' : parseFloat(gradingData[s.attemptId]?.score || '0') >= 60 ? 'bg-amber-500' : 'bg-red-400'}`}
                                                                                        style={{ width: `${Math.min(100, parseFloat(gradingData[s.attemptId]?.score || '0'))}%` }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Feedback */}
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-slate-700 mb-1.5">Komentar / Feedback <span className="text-slate-400 font-normal">(Opsional)</span></label>
                                                                            <textarea
                                                                                rows={3}
                                                                                placeholder="Tuliskan komentar atau saran untuk siswa..."
                                                                                value={gradingData[s.attemptId]?.feedback ?? ''}
                                                                                onChange={e => setGradingData(prev => ({
                                                                                    ...prev,
                                                                                    [s.attemptId!]: { ...prev[s.attemptId!], feedback: e.target.value }
                                                                                }))}
                                                                                className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400/50 outline-none resize-none"
                                                                            />
                                                                        </div>

                                                                        {/* Save button */}
                                                                        <button
                                                                            onClick={() => handleSaveGrade(s)}
                                                                            disabled={savingAttemptId === s.attemptId}
                                                                            className="w-full py-2.5 bg-[#3083FF] text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-[#3083FF]/90 transition-colors flex items-center justify-center gap-2"
                                                                        >
                                                                            {savingAttemptId === s.attemptId ? (
                                                                                <><Loader2 size={14} className="animate-spin" />Menyimpan...</>
                                                                            ) : savedAttemptIds.has(s.attemptId) ? (
                                                                                <><CheckCircle2 size={14} />Tersimpan!</>
                                                                            ) : (
                                                                                <><Save size={14} />Simpan Nilai</>
                                                                            )}
                                                                        </button>

                                                                        {/* Previous feedback display */}
                                                                        {s.teacherFeedback && !gradingData[s.attemptId]?.feedback && (
                                                                            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                                                                                <p className="text-xs font-medium text-emerald-700 mb-1">Feedback sebelumnya:</p>
                                                                                <p className="text-xs text-emerald-800">{s.teacherFeedback}</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200 p-6">
                                                                        <div className="text-center">
                                                                            <Clock size={24} className="mx-auto mb-2 text-slate-300" />
                                                                            <p className="text-xs text-slate-400">Siswa belum mengumpulkan tugas</p>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </motion.div>
                                                    </td>
                                                </tr>
                                            )}
                                        </AnimatePresence>
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filteredSubmissions.length > 0 && (
                        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
                            Menampilkan {filteredSubmissions.length} dari {submissions.length} siswa
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
