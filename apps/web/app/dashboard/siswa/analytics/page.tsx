"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import {
    Chart as ChartJS,
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
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
    TrendingUp,
    TrendingDown,
    Minus,
    Trophy,
    Target,
    Clock,
    BookOpen,
    Award,
    Brain,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    Calendar,
    Flame,
    Zap,
    ArrowUpRight,
    ArrowDownRight,
    Star,
    BarChart3,
    PieChart,
    Sparkles
} from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import {
    getStudentAnalytics,
    getStudentExamHistory,
    getStudentComparison
} from '@/lib/api/student-analytics';
import type {
    StudentAnalyticsData,
    ExamAttemptSummary,
    PerformanceTrend,
    SubjectPerformance,
    DifficultyPerformance,
    StrengthWeakness,
    StudyHabitStats
} from '@/lib/api/student-analytics';

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

type TimeRange = 'week' | 'month' | 'semester' | 'all';

export default function StudentAnalyticsPage() {
    const [loading, setLoading] = useMemoryState('siswa_analytics_loading', true);
    const [analytics, setAnalytics] = useState<StudentAnalyticsData | null>(null);
    const [examHistory, setExamHistory] = useMemoryState<any[]>('siswa_analytics_examHistory', []);
    const [comparison, setComparison] = useState<any>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>('all');
    const [user, setUser] = useState<any>(null);
    const [fullName, setFullName] = useState<string>('');

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            const user = await getSessionUser();
            if (user) {
                setUser(user);
                const [analyticsData, historyData, comparisonData] = await Promise.all([
                    getStudentAnalytics(),
                    getStudentExamHistory(20),
                    getStudentComparison(),
                ]);
                setAnalytics(analyticsData);
                setExamHistory(historyData);
                setComparison(comparisonData);
                setFullName(user.fullName ?? '');
            }
            setLoading(false);
        }
        loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins >= 60) {
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            return `${hours}j ${remainingMins}m`;
        }
        return `${mins}m ${secs}dtk`;
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return 'TBA';
        const date = new Date(dateStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? dateStr : dateStr + 'Z');
        if (isNaN(date.getTime())) return 'TBA';
        const day = date.getUTCDate();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const month = months[date.getUTCMonth()];
        const year = date.getUTCFullYear();
        return `${day} ${month} ${year}`;
    };

    const getGradeInfo = (percentage: number) => {
        if (percentage >= 90) return { grade: 'A', label: 'Sangat Baik', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-500' };
        if (percentage >= 80) return { grade: 'B', label: 'Baik', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-500' };
        if (percentage >= 70) return { grade: 'C', label: 'Cukup', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-500' };
        if (percentage >= 60) return { grade: 'D', label: 'Kurang', bg: 'bg-pink-100', text: 'text-pink-700', ring: 'ring-pink-500' };
        return { grade: 'E', label: 'Sangat Kurang', bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-500' };
    };

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
                <Loader2 size={36} className="text-[#0038A8] animate-spin" />
                <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-sans">Memuat analisis performa...</p>
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="py-20 px-6 text-center bg-white border border-dashed border-slate-200 rounded-2xl max-w-xl mx-auto w-full flex flex-col items-center mt-6">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                    <BarChart3 size={28} className="text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-1">Belum Ada Data Analisis</h3>
                <p className="text-slate-500 text-sm max-w-sm mb-0">Selesaikan ujian terlebih dahulu untuk melihat analisis performa belajar Anda secara detail.</p>
            </div>
        );
    }

    const { overview, subjectPerformance, difficultyPerformance, strengthsWeaknesses, studyHabits, performanceTrend } = analytics;
    const gradeInfo = getGradeInfo(overview.averageScore);

    // Chart data: Performance Trend
    const trendChartData = {
        labels: performanceTrend.map(p => formatDate(p.date)),
        datasets: [{
            label: 'Skor',
            data: performanceTrend.map(p => p.score),
            borderColor: '#0038A8',
            backgroundColor: 'rgba(0, 56, 168, 0.06)',
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: '#0038A8',
            pointBorderColor: '#fff',
            pointBorderWidth: 2
        }]
    };

    const trendChartOptions: any = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1e293b',
                titleColor: '#fff',
                bodyColor: '#fff',
                padding: 10,
                cornerRadius: 8
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
                grid: { color: 'rgba(0,0,0,0.03)' },
                ticks: { callback: (value: any) => `${value}%` }
            },
            x: {
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

    // Chart data: Difficulty Performance
    const strengthData = strengthsWeaknesses.filter(s => s.type === 'strength');
    const weaknessData = strengthsWeaknesses.filter(s => s.type === 'weakness');

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-in fade-in duration-700">

            <div className="space-y-6">
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
                        <p className="text-2xl font-black text-slate-800 leading-none font-mono">{overview.averageScore}%</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">dari {overview.totalExams} ujian</p>
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
                        <p className="text-2xl font-black text-slate-800 leading-none font-mono">#{overview.rank || '-'}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">dari {overview.totalStudents} siswa</p>
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
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Percentile</span>
                        </div>
                        <p className="text-2xl font-black text-slate-800 leading-none font-mono">{overview.percentile}%</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">lebih baik dari siswa lain</p>
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
                        <p className="text-2xl font-black text-slate-800 leading-none font-mono">{formatDuration(overview.totalStudyTime)}</p>
                        <p className="text-xs text-slate-400 font-medium mt-2">waktu belajar</p>
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
                        <div className="absolute left-0 top-0 h-full w-1.5 bg-[#0038A8]" />
                        <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                            <Zap size={16} className="text-[#0038A8]" />
                            Perbandingan dengan Rata-rata Kelas
                        </h3>
                        <div className="grid grid-cols-3 gap-6">
                            <div className="text-center">
                                <p className="text-4xl font-black text-[#0038A8] font-mono">{comparison.studentAverage}%</p>
                                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Skor Anda</p>
                            </div>
                            <div className="text-center flex flex-col items-center justify-center">
                                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${comparison.difference >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                                    {comparison.difference >= 0 ? (
                                        <ArrowUpRight size={14} />
                                    ) : (
                                        <ArrowDownRight size={14} />
                                    )}
                                    <span>{Math.abs(comparison.difference)}%</span>
                                </div>
                                <p className="text-xs text-slate-500 font-medium mt-2">
                                    {comparison.difference >= 0 ? 'di atas' : 'di bawah'} rata-rata
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-4xl font-black text-slate-300 font-mono">{comparison.classAverage}%</p>
                                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Rata-rata Kelas</p>
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
                            <TrendingUp size={16} className="text-[#0038A8]" />
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
                            <BookOpen size={16} className="text-[#0038A8]" />
                            Performa per Mata Pelajaran
                        </h3>
                        <div className="h-64">
                            <Bar data={subjectChartData} options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    y: {
                                        beginAtZero: true,
                                        max: 100,
                                        grid: { color: 'rgba(0,0,0,0.03)' },
                                        ticks: { callback: (value: any) => `${value}%` }
                                    },
                                    x: {
                                        grid: { display: false }
                                    }
                                }
                            } as any} />
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
                            <PieChart size={16} className="text-[#0038A8]" />
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
                                    const grade = getGradeInfo(subject.averageScore);
                                    return (
                                        <tr key={subject.subjectId} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className="font-semibold text-slate-800">{subject.subjectName}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-600 font-mono font-medium text-sm">{subject.totalExams}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${grade.bg} ${grade.text}`}>
                                                    {subject.averageScore}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center text-emerald-600 font-bold font-mono text-sm">{subject.highestScore}%</td>
                                            <td className="px-6 py-4 text-center text-rose-500 font-bold font-mono text-sm">{subject.lowestScore}%</td>
                                            <td className="px-6 py-4 text-center">
                                                <div className={`flex items-center justify-center gap-1.5 ${getTrendColor(subject.trend)}`}>
                                                    {getTrendIcon(subject.trend)}
                                                    <span className="text-xs font-bold uppercase tracking-wider">{subject.trend}</span>
                                                </div>
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
                        <div className="absolute left-0 top-0 h-full w-1.5 bg-[#0038A8]" />
                        <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                            <Brain size={16} className="text-[#0038A8]" />
                            Kesulitan Soal
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
                                            <span className="text-xs font-semibold text-slate-500 font-mono">{diff.percentage}% ({diff.correctAnswers}/{diff.totalQuestions})</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
                                                style={{ width: `${diff.percentage}%` }}
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
                            Kelebihan Belajar
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
                                                <p className="text-xs text-emerald-700/90 mt-1 leading-normal font-sans font-medium">{strength.description}</p>
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
                            Area Pengembangan
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
                                                <p className="text-xs text-amber-700/90 mt-1 leading-normal font-sans font-medium">{weakness.description}</p>
                                                <p className="text-[10px] text-amber-650 text-amber-600 font-bold mt-2 italic leading-normal">{weakness.recommendation}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-10">
                                <CheckCircle2 className="w-10 h-10 text-amber-300 mx-auto mb-3" />
                                <p className="text-amber-800 font-bold text-xs uppercase tracking-wide">Luar Biasa!</p>
                                <p className="text-xs text-amber-600/95 mt-1 max-w-xs mx-auto">Hebat, tidak ada kelemahan kritis yang terdeteksi pada performa belajar Anda saat ini.</p>
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
                    <div className="absolute left-0 top-0 h-full w-1.5 bg-[#0038A8]" />
                    <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                        <Clock size={16} className="text-[#0038A8]" />
                        Kebiasaan Belajar
                    </h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-[#0038A8] font-mono leading-none">{formatDuration(studyHabits.averageTimePerExam)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Rata-rata / Ujian</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-emerald-600 font-mono leading-none">{formatDuration(studyHabits.fastestCompletion)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Tercepat</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-rose-500 font-mono leading-none">{formatDuration(studyHabits.slowestCompletion)}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Terlama</p>
                        </div>
                        <div className="text-center p-4 bg-slate-50/50 border border-slate-100 rounded-xl">
                            <p className="text-xl font-bold text-indigo-600 font-mono leading-none">{studyHabits.averageQuestionsPerMinute}</p>
                            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wide">Soal / Menit</p>
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
                            <Calendar size={16} className="text-[#0038A8]" />
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
                                const grade = getGradeInfo(exam.score);
                                return (
                                    <div key={exam.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${grade.bg} ${grade.text} border border-white`}>
                                                {grade.grade}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-800 text-sm truncate leading-snug">{exam.examTitle}</p>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5">{(exam.subjectName || 'Umum')} • {formatDate(exam.finishedAt || exam.startedAt)}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 ml-4">
                                            <p className="text-base font-black text-slate-800 font-mono leading-none">{exam.score}%</p>
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
