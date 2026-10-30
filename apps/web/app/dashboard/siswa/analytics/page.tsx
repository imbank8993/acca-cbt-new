"use client";
import { useSchoolTimeZone } from "@/lib/useSchoolTimeZone";
import { formatSchoolDate } from "@/lib/school-time";
import type {
StudentAnalyticsData,
} from '@/lib/api/student-analytics';
import {
getStudentAnalytics
} from '@/lib/api/student-analytics';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import {
ArcElement,
BarElement,
CategoryScale,
Chart as ChartJS,
Filler,
Legend,
LinearScale,
LineElement,
PointElement,
Title,
Tooltip
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { motion } from 'framer-motion';
import {
AlertTriangle,
ArrowDownRight,
ArrowUpRight,
Award,
BarChart3,
BookOpen,
Brain,
Calendar,
CheckCircle2,
Clock,
Flame,
Loader2,
Minus,
PieChart,
Star,
Target,
TrendingDown,
TrendingUp,
Trophy,
Zap
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';
import { Bar,Line } from 'react-chartjs-2';

// Register ChartJS
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

export default function StudentAnalyticsPage() {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [loading, setLoading] = useState(true);
    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [analytics, setAnalytics] = useState<StudentAnalyticsData | null>(null);
    const [loadError, setLoadError] = useState('');
    const requestVersion = useRef(0);
    const [chartFontFamily, setChartFontFamily] = useState('Poppins, sans-serif');

    useEffect(() => {
        let active = true;
        // Canvas charts need the resolved Next.js font name rather than a CSS variable.
        void document.fonts.ready.then(() => {
            if (active) setChartFontFamily(getComputedStyle(document.body).getPropertyValue('--font-poppins').trim() || 'Poppins, sans-serif');
        });
        return () => { active = false; };
    }, []);

    const inFlight = useRef<number | null>(null);
    const lastSnapshot = useRef<string | undefined>(undefined);
    const activeAnalytics = analytics?.scoringModels?.find(model => model.scoreType === selectedModel)?.analytics || analytics;
    const examHistory = activeAnalytics?.examHistory || [];
    const comparison = activeAnalytics?.comparison || null;

    const loadData = useCallback(async () => {
        if (inFlight.current !== null) return;
        const version = ++requestVersion.current;
        inFlight.current = version;
        // Retain the current charts during background checks, including failed checks.
        if (lastSnapshot.current === undefined) setLoading(true);
        try {
            const next = await getStudentAnalytics();
            if (version !== requestVersion.current) return;
            const snapshot = JSON.stringify(next);
            if (snapshot !== lastSnapshot.current) {
                lastSnapshot.current = snapshot;
                setAnalytics(next);
            }
            setLoadError('');
        } catch (error) {
            if (version === requestVersion.current) setLoadError(error instanceof Error ? error.message : 'Analisis belum dapat dimuat.');
        } finally {
            if (inFlight.current === version) inFlight.current = null;
            if (version === requestVersion.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const pendingRequests = requestVersion;
        const pendingFlight = inFlight;
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        return () => {
            pendingRequests.current++;
            pendingFlight.current = null;
            window.clearTimeout(initialLoad);
        };
    }, [loadData]);
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    const formatDuration = (seconds: number | null) => {
        if (seconds === null || !Number.isFinite(seconds)) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins >= 60) {
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            return `${hours}j ${remainingMins}m`;
        }
        return `${mins}m ${secs}dtk`;
    };

    const formatDate = (dateStr: string) => timeZoneError ? 'Zona waktu belum tersedia' : formatSchoolDate(dateStr, timeZone);
    const formatScore = (score: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(score);

    const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
        if (trend === 'up') return <TrendingUp className="w-4 h-4 text-emerald-500" />;
        if (trend === 'down') return <TrendingDown className="w-4 h-4 text-red-500" />;
        return <Minus className="w-4 h-4 text-slate-400" />;
    };

    const getTrendColor = (trend: 'up' | 'down' | 'stable') => {
        if (trend === 'up') return 'text-emerald-600';
        if (trend === 'down') return 'text-red-600';
        return 'text-slate-500';
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 space-y-3">
                <Loader2 size={36} className="text-[#3083FF] animate-spin" />
                <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-poppins">Memuat analisis performa...</p>
            </div>
        );
    }

    if (loadError && !analytics) return (
        <div role="alert" className="max-w-xl mx-auto mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="font-semibold text-red-700">Analisis gagal dimuat</p>
            <p className="mt-2 text-sm text-red-600">{loadError}</p>
            <button type="button" onClick={() => void loadData()} className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Coba lagi</button>
        </div>
    );

    if (!analytics) {
        return (
            <div className="py-20 px-6 text-center bg-white border border-dashed border-slate-200 rounded-2xl max-w-xl mx-auto w-full flex flex-col items-center mt-6">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                    <BarChart3 size={28} className="text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-1">Belum Ada Data Analisis</h3>
                <p className="text-slate-500 text-sm max-w-sm mb-0">Analisis tersedia setelah nilai akhir ujian dibuka oleh guru.</p>
            </div>
        );
    }

    const { overview, subjectPerformance, difficultyPerformance, strengthsWeaknesses, studyHabits, performanceTrend } = (analytics.scoringModels?.find(model => model.scoreType === selectedModel)?.analytics || analytics);
    // Nilai IRT dilaporkan pada skala 200–800 (500 + 100θ), tanpa satuan persen.
    const irtScores = overview.scoreType?.startsWith('irt_') === true;
    const scoreUnit = irtScores ? '' : '%';

    // Chart data: Performance Trend
    const trendChartData = {
        labels: performanceTrend.map(p => formatDate(p.date)),
        datasets: [{
            label: 'Skor',
            data: performanceTrend.map(p => p.score),
            borderColor: '#3083FF',
            backgroundColor: 'rgba(0, 56, 168, 0.06)',
            fill: true,
            tension: 0,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: '#3083FF',
            pointBorderColor: '#fff',
            pointBorderWidth: 2
        }]
    };

    const trendChartOptions: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1e293b',
                titleColor: '#fff',
                bodyColor: '#fff',
                titleFont: { family: chartFontFamily },
                bodyFont: { family: chartFontFamily },
                padding: 10,
                cornerRadius: 8
            }
        },
        scales: {
            y: {
                beginAtZero: !irtScores,
                min: irtScores ? 200 : undefined,
                max: irtScores ? 800 : 105,
                grid: { color: 'rgba(0,0,0,0.03)' },
                ticks: { stepSize: irtScores ? 100 : 10, font: { family: chartFontFamily }, callback: (value) => irtScores ? `${value}` : Number(value) <= 100 ? `${value}%` : '' }
            },
            x: {
                ticks: { font: { family: chartFontFamily } },
                grid: { display: false }
            }
        }
    };

    // Chart data: Subject Performance
    const subjectChartData = {
        labels: subjectPerformance.map(s => s.subjectName),
        datasets: [{
            label: 'Rata-rata Skor',
            data: subjectPerformance.map(s => s.averageScore),
            backgroundColor: [
                'rgba(0, 56, 168, 0.8)',
                'rgba(34, 197, 94, 0.8)',
                'rgba(249, 115, 22, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(168, 85, 247, 0.8)'
            ],
            borderRadius: 6,
            barThickness: 32
        }]
    };

    const subjectChartOptions: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                titleFont: { family: chartFontFamily },
                bodyFont: { family: chartFontFamily },
            },
        },
        scales: {
            y: {
                beginAtZero: !irtScores,
                min: irtScores ? 200 : undefined,
                max: irtScores ? 800 : 100,
                grid: { color: 'rgba(0,0,0,0.03)' },
                ticks: { font: { family: chartFontFamily }, callback: (value) => `${value}${scoreUnit}` },
            },
            x: { grid: { display: false }, ticks: { font: { family: chartFontFamily } } },
        },
    };

    // Chart data: Difficulty Performance
    const strengthData = strengthsWeaknesses.filter(s => s.type === 'strength');
    const weaknessData = strengthsWeaknesses.filter(s => s.type === 'weakness');

    return (
        <div className="font-poppins max-w-7xl mx-auto pb-24 space-y-6 animate-in fade-in duration-700">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{timeZoneError}</div>}

            {loadError && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Data terakhir tetap ditampilkan. {loadError}</div>}
            <div className="space-y-6">
                {analytics.scoringModels && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 border border-slate-100">
                    <label htmlFor="scoring-model" className="text-sm font-semibold text-slate-700">Model penskoran</label>
                    <select id="scoring-model" value={selectedModel || analytics.overview.scoreType} onChange={event => setSelectedModel(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        {analytics.scoringModels.map(model => <option key={model.scoreType} value={model.scoreType}>{model.scoreLabel}</option>)}
                    </select>
                </div>}
                {/* Overview Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Rata-rata */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 }}
                        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden flex flex-col text-left pl-6"
                    >
                        <div className="absolute left-0 top-0 h-full w-1 bg-indigo-500" />
                        <div className="flex items-center gap-3 mb-2.5">
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100/50">
                                <Target size={16} />
                            </div>
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Rata-rata</span>
                        </div>
                        <p className="text-2xl font-semibold text-slate-800 leading-none tabular-nums tracking-tight">{overview.averageScore}{scoreUnit}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">{overview.scoreLabel || 'Klasikal'} · dari {overview.totalExams} ujian dengan model yang sama</p>
                    </motion.div>

                    {/* Peringkat */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden flex flex-col text-left pl-6"
                    >
                        <div className="absolute left-0 top-0 h-full w-1 bg-emerald-500" />
                        <div className="flex items-center gap-3 mb-2.5">
                            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100/50">
                                <Trophy size={16} />
                            </div>
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Peringkat</span>
                        </div>
                        <p className="text-2xl font-semibold text-slate-800 leading-none tabular-nums tracking-tight">#{overview.rank || '-'}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">{overview.rank == null ? 'Peserta pembanding belum cukup' : `dari ${overview.totalStudents} peserta ujian yang sama`}</p>
                    </motion.div>

                    {/* Percentile */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden flex flex-col text-left pl-6"
                    >
                        <div className="absolute left-0 top-0 h-full w-1 bg-amber-500" />
                        <div className="flex items-center gap-3 mb-2.5">
                            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100/50">
                                <Flame size={16} />
                            </div>
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Persentil</span>
                        </div>
                        <p className="text-2xl font-semibold text-slate-800 leading-none tabular-nums tracking-tight">{overview.percentile == null ? '—' : `${overview.percentile}%`}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">peserta pembanding dengan rata-rata lebih rendah</p>
                    </motion.div>

                    {/* Total Waktu */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden flex flex-col text-left pl-6"
                    >
                        <div className="absolute left-0 top-0 h-full w-1 bg-blue-500" />
                        <div className="flex items-center gap-3 mb-2.5">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100/50">
                                <Clock size={16} />
                            </div>
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Total Waktu</span>
                        </div>
                        <p className="text-2xl font-semibold text-slate-800 leading-none tabular-nums tracking-tight">{formatDuration(overview.totalStudyTime)}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">waktu pengerjaan ujian</p>
                    </motion.div>
                </div>

                {/* Comparison with Class */}
                {comparison && (
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 }}
                        className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm flex flex-col text-left relative overflow-hidden pl-7"
                    >
                        <div className="absolute left-0 top-0 h-full w-1.5 bg-[#3083FF]" />
                        <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                            <Zap size={16} className="text-[#3083FF]" />
                            Perbandingan Peserta Ujian yang Sama
                        </h3>
                        <div className="grid grid-cols-3 gap-6">
                            <div className="text-center">
                                <p className="text-4xl font-semibold text-[#3083FF] tabular-nums tracking-tight">{comparison.studentAverage}{scoreUnit}</p>
                                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Skor Anda</p>
                            </div>
                            <div className="text-center flex flex-col items-center justify-center">
                                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${comparison.difference >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                                    {comparison.difference >= 0 ? (
                                        <ArrowUpRight size={14} />
                                    ) : (
                                        <ArrowDownRight size={14} />
                                    )}
                                    <span>{Math.abs(comparison.difference)} poin</span>
                                </div>
                                <p className="text-xs text-slate-500 font-medium mt-2">
                                    {comparison.difference === 0 ? 'sama dengan' : comparison.difference > 0 ? 'di atas' : 'di bawah'} rata-rata
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-4xl font-semibold text-slate-300 tabular-nums tracking-tight">{comparison.classAverage}{scoreUnit}</p>
                                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">{comparison.totalPeers} peserta pembanding</p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Charts Row */}
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Performance Trend Chart */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm text-left"
                    >
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <TrendingUp size={16} className="text-[#3083FF]" />
                            Tren Performa
                        </h3>
                        <div className="h-64">
                            <Line data={trendChartData} options={trendChartOptions} />
                        </div>
                    </motion.div>

                    {/* Subject Performance Chart */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 }}
                        className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm text-left"
                    >
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <BookOpen size={16} className="text-[#3083FF]" />
                            Performa per Mata Pelajaran
                        </h3>
                        <div className="h-64">
                            <Bar data={subjectChartData} options={subjectChartOptions} />
                        </div>
                    </motion.div>
                </div>

                {/* Subject Performance Table */}
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden text-left"
                >
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <PieChart size={16} className="text-[#3083FF]" />
                            Detail per Mata Pelajaran
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50/50">
                                <tr>
                                    <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Mata Pelajaran</th>
                                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Jumlah Ujian</th>
                                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Rata-rata</th>
                                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Tertinggi</th>
                                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Terendah</th>
                                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Tren</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {subjectPerformance.map((subject) => {
                                    return (
                                        <tr key={subject.subjectId} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className="font-semibold text-slate-800">{subject.subjectName}</span><span className="block text-xs text-slate-400">{subject.subjectId.endsWith(':classical') ? 'Klasikal' : 'IRT'}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-600 tabular-nums tracking-tight font-medium text-sm">{subject.totalExams}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                                                    {formatScore(subject.averageScore)}{subject.subjectId.endsWith(':classical') ? '%' : ''}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center text-emerald-600 font-bold tabular-nums tracking-tight text-sm">{formatScore(subject.highestScore)}{subject.subjectId.endsWith(':classical') ? '%' : ''}</td>
                                            <td className="px-6 py-4 text-center text-rose-500 font-bold tabular-nums tracking-tight text-sm">{formatScore(subject.lowestScore)}{subject.subjectId.endsWith(':classical') ? '%' : ''}</td>
                                            <td className="px-6 py-4 text-center">
                                                {subject.totalExams < 2 ? <span className="text-xs text-slate-400">Belum ada data</span> : (
                                                <div className={`flex items-center justify-center gap-1.5 ${getTrendColor(subject.trend)}`}>
                                                    {getTrendIcon(subject.trend)}
                                                    <span className="text-xs font-bold uppercase tracking-wider">{subject.trend === 'up' ? 'Naik' : subject.trend === 'down' ? 'Turun' : 'Stabil'}</span>
                                                </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </motion.div>

                {/* Difficulty & Strength/Weakness Row */}
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Difficulty Performance */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 }}
                        className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm text-left relative overflow-hidden pl-7"
                    >
                        <div className="absolute left-0 top-0 h-full w-1.5 bg-[#3083FF]" />
                        <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                            <Brain size={16} className="text-[#3083FF]" />
                            Analisis tingkat kesulitan
                        </h3>
                        <div className="space-y-4">
                            {difficultyPerformance.map((diff) => {
                                const colors = {
                                    easy: { bar: 'bg-emerald-500', text: 'text-emerald-600', label: 'Mudah' },
                                    medium: { bar: 'bg-amber-500', text: 'text-amber-600', label: 'Sedang' },
                                    hard: { bar: 'bg-rose-500', text: 'text-rose-600', label: 'Sulit' }
                                }[diff.difficulty];

                                return (
                                    <div key={diff.difficulty} className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className={`font-bold text-xs uppercase tracking-wide ${colors.text}`}>{colors.label}</span>
                                            <span className="text-xs font-semibold text-slate-500 tabular-nums tracking-tight">{diff.percentage == null ? 'Belum ada data' : `${diff.percentage}% (${diff.correctAnswers}/${diff.totalQuestions})`}</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
                                                style={{ width: `${diff.percentage ?? 0}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>

                    {/* Strengths */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 rounded-2xl p-6 border border-emerald-200/50 text-left"
                    >
                        <h3 className="font-bold text-emerald-800 mb-4 flex items-center gap-2">
                            <Star size={16} />
                            Analisis Jenis Soal (+)
                        </h3>
                        {strengthData.length > 0 ? (
                            <div className="space-y-3.5">
                                {strengthData.map((strength, idx) => (
                                    <div key={idx} className="bg-white border border-emerald-100/30 rounded-xl p-3.5 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-100/60 flex items-center justify-center flex-shrink-0 text-emerald-600">
                                                <CheckCircle2 size={15} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-emerald-800 text-xs truncate leading-snug">{strength.category}</p>
                                                <p className="text-xs text-emerald-700/90 mt-1 leading-normal font-poppins font-medium">{strength.description}</p>
                                                <p className="text-[10px] text-emerald-600 font-bold mt-2 italic leading-normal">{strength.recommendation}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-10">
                                <Award className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
                                <p className="text-emerald-800 font-bold text-xs uppercase tracking-wide">Terus Belajar!</p>
                                <p className="text-xs text-emerald-600/95 mt-1 max-w-xs mx-auto">Kelebihan akan terdeteksi otomatis setelah Anda menyelesaikan lebih banyak ujian.</p>
                            </div>
                        )}
                    </motion.div>

                    {/* Weaknesses */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.55 }}
                        className="bg-gradient-to-br from-amber-50/50 to-amber-100/30 rounded-2xl p-6 border border-amber-200/50 text-left"
                    >
                        <h3 className="font-bold text-amber-800 mb-4 flex items-center gap-2">
                            <AlertTriangle size={16} />
                            Analisis Jenis Soal (-)
                        </h3>
                        {weaknessData.length > 0 ? (
                            <div className="space-y-3.5">
                                {weaknessData.map((weakness, idx) => (
                                    <div key={idx} className="bg-white border border-amber-100/30 rounded-xl p-3.5 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-amber-100/60 flex items-center justify-center flex-shrink-0 text-amber-605 text-amber-600">
                                                <Target size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-amber-800 text-xs truncate leading-snug">{weakness.category}</p>
                                                <p className="text-xs text-amber-700/90 mt-1 leading-normal font-poppins font-medium">{weakness.description}</p>
                                                <p className="text-[10px] text-amber-650 text-amber-600 font-bold mt-2 italic leading-normal">{weakness.recommendation}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-10">
                                <CheckCircle2 className="w-10 h-10 text-amber-300 mx-auto mb-3" />
                                <p className="text-amber-800 font-bold text-xs uppercase tracking-wide">Belum ada temuan</p>
                                <p className="text-xs text-amber-600/95 mt-1 max-w-xs mx-auto">Temuan membutuhkan sedikitnya 5 soal dengan penilaian yang pasti per tipe.</p>
                            </div>
                        )}
                    </motion.div>
                </div>

                {/* Study Habits */}
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm text-left relative overflow-hidden pl-7"
                >
                    <div className="absolute left-0 top-0 h-full w-1.5 bg-[#3083FF]" />
                    <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                        <Clock size={16} className="text-[#3083FF]" />
                        Waktu Pengerjaan Ujian
                    </h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-[#3083FF] tabular-nums tracking-tight leading-none">{formatDuration(studyHabits.averageTimePerExam)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Rata-rata / Ujian</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-emerald-600 tabular-nums tracking-tight leading-none">{formatDuration(studyHabits.fastestCompletion)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Tercepat</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-rose-500 tabular-nums tracking-tight leading-none">{formatDuration(studyHabits.slowestCompletion)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Terlama</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-indigo-600 tabular-nums tracking-tight leading-none">{studyHabits.averageQuestionsPerMinute == null ? '—' : formatScore(studyHabits.averageQuestionsPerMinute)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Soal / Menit</p>
                            {studyHabits.speedMeasuredExams > 0 && <p className="mt-1 text-[10px] text-slate-500">{studyHabits.speedAnsweredQuestions} soal dijawab · {studyHabits.speedMeasuredExams} ujian</p>}
                        </div>
                    </div>
                </motion.div>

                {/* Riwayat ujian terakhir */}
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.65 }}
                    className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden text-left"
                >
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Calendar size={16} className="text-[#3083FF]" />
                            Riwayat Ujian
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {(() => {
                            const displayExams = examHistory.slice(0, 5);
                            if (displayExams.length === 0) {
                                return <div className="px-6 py-8 text-center text-slate-400 font-medium text-xs">Belum ada riwayat ujian</div>;
                            }
                            return displayExams.map((exam) => {
                                return (
                                    <div key={exam.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-50 text-[#3083FF] border border-blue-100">
                                                <BookOpen size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-800 text-sm truncate leading-snug">{exam.examTitle}</p>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5">{(exam.subjectName || 'Umum')} • {formatDate(exam.finishedAt || exam.startedAt)}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 ml-4">
                                            <p className="text-base font-semibold text-slate-800 tabular-nums tracking-tight leading-none">{formatScore(exam.score)}{scoreUnit}</p>
                                            <p className="text-[10px] text-slate-400 font-bold mt-1.5 uppercase tracking-wide leading-none">{formatDuration(exam.timeSpentSeconds)}</p>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </motion.div>

                {/* Recent Exam History - Global */}
            </div>
        </div>
    );
}
