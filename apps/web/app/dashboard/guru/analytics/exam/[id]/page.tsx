"use client";
import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Users, Clock, Target, Award, Download,
  ChevronDown, ChevronUp, Filter, Search, BarChart3,
  CheckCircle2, XCircle, AlertTriangle, Eye, Loader2
} from 'lucide-react';

// Dynamic import untuk komponen berat
import dynamic from 'next/dynamic';
import { getExamAnalytics, getStudentPerformance, getAttemptReviewForStaff, getQuestionResponsesAction } from '@/lib/api/analytics';
import { TableSkeleton, CardSkeleton } from '@/app/components/ui/SkeletonPatterns';
import type { ExamAnalyticsSummary, StudentPerformance, QuestionAnalytics } from '@/app/types';
import { useMemoryState } from '@/lib/useMemoryState';
import { formatStudentAnswer, formatAnswerKey, stripHtml } from '@/lib/answer-display';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';

// Lazy load chart components
const StatsGrid = dynamic(
  () => import('@/app/components/ui/Charts').then(mod => ({ default: mod.StatsGrid })),
  { loading: () => <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /></div> }
);
const StatCard = dynamic(
  () => import('@/app/components/ui/Charts').then(mod => ({ default: mod.StatCard })),
  { ssr: false, loading: () => <div className="bg-white p-6 rounded-2xl border border-slate-200 animate-pulse"><div className="h-4 bg-slate-100 rounded w-1/2 mb-2"></div><div className="h-8 bg-slate-100 rounded w-3/4"></div></div> }
);
const ScoreDistributionChart = dynamic(
  () => import('@/app/components/ui/Charts').then(mod => ({ default: mod.ScoreDistributionChart })),
  { ssr: false, loading: () => <div className="h-48 bg-slate-50 rounded-xl animate-pulse"></div> }
);

export default function ExamResultsDetailPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.id as string;

  const [loading, setLoading] = useMemoryState('guru_analytics_exam__id__loading', true);
  const [analytics, setAnalytics] = useState<ExamAnalyticsSummary | null>(null);
  const [students, setStudents] = useMemoryState<StudentPerformance[]>('guru_analytics_exam__id__students', []);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'name'>('score');
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'questions'>('overview');
  const [isExporting, setIsExporting] = useState(false);

  // Detail jawaban per siswa (modal) & respons per soal (lazy saat expand)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewData, setReviewData] = useState<any>(null);
  const [questionDetails, setQuestionDetails] = useState<Record<string, any>>({});
  const [questionDetailLoading, setQuestionDetailLoading] = useState<string | null>(null);

  const openStudentReview = async (attemptId?: string) => {
    if (!attemptId) return;
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewData(null);
    try {
      const data = await getAttemptReviewForStaff(attemptId);
      setReviewData(data);
    } catch (e) {
      console.error('Load attempt review error:', e);
    } finally {
      setReviewLoading(false);
    }
  };

  const toggleQuestion = async (questionId: string) => {
    const next = expandedQuestion === questionId ? null : questionId;
    setExpandedQuestion(next);
    if (next && !questionDetails[next]) {
      setQuestionDetailLoading(next);
      try {
        const detail = await getQuestionResponsesAction(examId, next);
        setQuestionDetails(prev => ({ ...prev, [next]: detail }));
      } catch (e) {
        console.error('Load question responses error:', e);
      } finally {
        setQuestionDetailLoading(null);
      }
    }
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [analyticsData, studentsData] = await Promise.all([
          getExamAnalytics(examId),
          getStudentPerformance(examId),
        ]);

        setAnalytics(analyticsData);
        setStudents(studentsData);
      } catch (error) {
        console.error('Error fetching exam results:', error);
      } finally {
        setLoading(false);
      }
    }

    if (examId) {
      fetchData();
    }
  }, [examId]);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const { getExamExportData } = await import('@/lib/api/analytics');
      const XLSX = await import('xlsx');
      
      const data = await getExamExportData(examId);
      
      // Build Sheet 1: Overview
      const overviewData = data.attempts.map((attempt: any) => ({
        'Nama Siswa': attempt.profiles?.full_name || 'Tanpa Nama',
        'Email': attempt.profiles?.email || '-',
        'Skor Total': attempt.total_score || 0,
        'Waktu Mulai': new Date(attempt.started_at).toLocaleString('id-ID'),
        'Waktu Selesai': attempt.finished_at ? new Date(attempt.finished_at).toLocaleString('id-ID') : '-',
        'Durasi (Menit)': attempt.finished_at && attempt.started_at 
          ? Math.round((new Date(attempt.finished_at).getTime() - new Date(attempt.started_at).getTime()) / 60000) 
          : '-',
        'Status': attempt.status,
      }));
      const wsOverview = XLSX.utils.json_to_sheet(overviewData);

      // Build Sheet 2: Detail Jawaban
      const detailData = data.attempts.map((attempt: any) => {
        const row: any = {
          'Nama Siswa': attempt.profiles?.full_name || 'Tanpa Nama',
          'Skor Total': attempt.total_score || 0,
        };
        
        // Map answers
        data.questions.forEach((q: any, index: number) => {
          const ans = attempt.answers?.find((a: any) => a.question_id === q.id);
          if (ans) {
            if (q.type === 'essay' || q.type === 'esay' || q.type === 'uraian') {
              row[`Soal ${index + 1}`] = ans.essay_answer || '-';
            } else {
              // Find option label
              const selectedOption = q.bank_question_options?.find((opt: any) => opt.id === ans.selected_option_id);
              if (selectedOption) {
                row[`Soal ${index + 1}`] = String.fromCharCode(65 + q.bank_question_options.indexOf(selectedOption));
              } else {
                row[`Soal ${index + 1}`] = '-';
              }
            }
          } else {
            row[`Soal ${index + 1}`] = '-';
          }
        });

        // Tautan tugas if any
        if (attempt.metadata?.assignment_submission) {
          row['Tautan Dokumen'] = attempt.metadata.assignment_submission.documentUrl || '-';
          row['Tautan Video'] = attempt.metadata.assignment_submission.videoUrl || '-';
        }

        return row;
      });
      const wsDetail = XLSX.utils.json_to_sheet(detailData);

      // Build Sheet 3: Referensi Soal
      const questionData = data.questions.map((q: any, index: number) => {
        const correctOptions = q.bank_question_options?.filter((opt: any) => opt.is_correct).map((opt: any) => {
            const optIndex = q.bank_question_options.indexOf(opt);
            return String.fromCharCode(65 + optIndex);
        }).join(', ');

        return {
          'No': index + 1,
          'Tipe Soal': q.type,
          'Pertanyaan': q.question_text?.replace(/<[^>]+>/g, '') || '', // strip HTML
          'Kunci Jawaban': correctOptions || 'Essay/Subjektif',
          'Skor Default': q.score_default || 1,
        };
      });
      const wsQuestions = XLSX.utils.json_to_sheet(questionData);

      // Create Workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsOverview, "Ringkasan Nilai");
      XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Jawaban");
      XLSX.utils.book_append_sheet(wb, wsQuestions, "Referensi Soal");

      // Save
      XLSX.writeFile(wb, `Hasil_Ujian_${data.exam?.title || 'Export'}.xlsx`);

    } catch (error) {
      console.error('Export error:', error);
      alert('Gagal mengekspor data. Pastikan ada data hasil ujian.');
    } finally {
      setIsExporting(false);
    }
  };

  // Mock data for demo
  const mockAnalytics: ExamAnalyticsSummary = {
    exam_id: examId,
    exam_title: 'Matematika - Ulangan Harian',
    total_participants: 45,
    completed_count: 38,
    in_progress_count: 2,
    not_started_count: 5,
    score_stats: {
      average: 78,
      median: 80,
      highest: 100,
      lowest: 45,
      total: 2964,
      completed: 38,
    },
    time_stats: {
      average_seconds: 2700,
      median_seconds: 2400,
      fastest_seconds: 1800,
      slowest_seconds: 3600,
      total_time_used_seconds: 102600,
    },
    question_analytics: [
      { question_id: '1', question_text: 'Hitung luas permukaan kubus dengan sisi 5cm', question_type: 'essay', total_attempts: 38, correct_count: 12, wrong_count: 20, unanswered_count: 6, correct_percentage: 32, average_time_seconds: 180, difficulty: 'hard' },
      { question_id: '2', question_text: 'Tentukan hasil dari 15 + 27 × 3', question_type: 'mcq', total_attempts: 38, correct_count: 35, wrong_count: 3, unanswered_count: 0, correct_percentage: 92, average_time_seconds: 45, difficulty: 'easy' },
      { question_id: '3', question_text: 'Apakah 144 adalah bilangan prima?', question_type: 'mcq', total_attempts: 38, correct_count: 28, wrong_count: 10, unanswered_count: 0, correct_percentage: 74, average_time_seconds: 60, difficulty: 'medium' },
    ],
    difficulty_stats: { easy: { count: 5, avg_correct_percentage: 88 }, medium: { count: 8, avg_correct_percentage: 68 }, hard: { count: 2, avg_correct_percentage: 32 } },
    score_distribution: [
      { range: '0-20', count: 0, percentage: 0 },
      { range: '21-40', count: 2, percentage: 5 },
      { range: '41-60', count: 8, percentage: 21 },
      { range: '61-80', count: 15, percentage: 39 },
      { range: '81-100', count: 13, percentage: 34 },
    ],
    time_distribution: [],
  };

  const mockStudents: StudentPerformance[] = [
    { student_id: '1', student_name: 'Ahmad Fauzi', student_email: 'ahmad@email.com', total_exams: 5, completed_exams: 5, average_score: 95, highest_score: 100, lowest_score: 85, total_time_used_seconds: 12600, rank: 1 },
    { student_id: '2', student_name: 'Siti Nurhaliza', student_email: 'siti@email.com', total_exams: 5, completed_exams: 5, average_score: 92, highest_score: 98, lowest_score: 88, total_time_used_seconds: 13200, rank: 2 },
    { student_id: '3', student_name: 'Budi Santoso', student_email: 'budi@email.com', total_exams: 5, completed_exams: 5, average_score: 88, highest_score: 95, lowest_score: 80, total_time_used_seconds: 14400, rank: 3 },
    { student_id: '4', student_name: 'Dewi Lestari', student_email: 'dewi@email.com', total_exams: 5, completed_exams: 5, average_score: 85, highest_score: 92, lowest_score: 78, total_time_used_seconds: 13800, rank: 4 },
    { student_id: '5', student_name: 'Eko Prasetyo', student_email: 'eko@email.com', total_exams: 5, completed_exams: 5, average_score: 82, highest_score: 90, lowest_score: 75, total_time_used_seconds: 15000, rank: 5 },
  ];

  const displayAnalytics = loading ? mockAnalytics : (analytics ?? mockAnalytics);
  const displayStudents = loading ? mockStudents : students;

  const filteredStudents = displayStudents
    .filter(s => s.student_name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => sortBy === 'score' ? b.average_score - a.average_score : a.student_name.localeCompare(b.student_name));

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins} menit`;
  };

  const getGrade = (score: number) => {
    if (score >= 90) return { label: 'A', color: 'bg-emerald-100 text-emerald-700' };
    if (score >= 80) return { label: 'B', color: 'bg-blue-100 text-blue-700' };
    if (score >= 70) return { label: 'C', color: 'bg-amber-100 text-amber-700' };
    if (score >= 60) return { label: 'D', color: 'bg-pink-100 text-pink-700' };
    return { label: 'E', color: 'bg-red-100 text-red-700' };
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/dashboard/guru/analytics')}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{displayAnalytics.exam_title}</h1>
              <p className="text-sm text-slate-500">Detail Hasil Ujian</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {isExporting ? 'Mengekspor...' : 'Export'}
            </button>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Stats */}
        <StatsGrid>
          <StatCard
            title="Total Peserta"
            value={displayAnalytics.total_participants}
            icon={<Users size={20} />}
            loading={loading}
          />
          <StatCard
            title="Selesai Mengerjakan"
            value={displayAnalytics.completed_count}
            icon={<CheckCircle2 size={20} />}
            loading={loading}
          />
          <StatCard
            title="Rata-rata Nilai"
            value={`${displayAnalytics.score_stats.average}%`}
            icon={<Target size={20} />}
            trend={{ value: 5, direction: 'up' }}
            loading={loading}
          />
          <StatCard
            title="Waktu Rata-rata"
            value={formatDuration(displayAnalytics.time_stats.average_seconds)}
            icon={<Clock size={20} />}
            loading={loading}
          />
        </StatsGrid>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white rounded-xl p-1 border border-slate-200 w-fit">
          {(['overview', 'students', 'questions'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab === 'overview' ? 'Ringkasan' : tab === 'students' ? 'Siswa' : 'Soal'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Distribution */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-6">Distribusi Nilai</h3>
              <ScoreDistributionChart data={displayAnalytics.score_distribution} className="h-48" />
              <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{displayAnalytics.score_stats.highest}%</p>
                  <p className="text-xs text-slate-500">Tertinggi</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-800">{displayAnalytics.score_stats.average}%</p>
                  <p className="text-xs text-slate-500">Rata-rata</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-500">{displayAnalytics.score_stats.lowest}%</p>
                  <p className="text-xs text-slate-500">Terendah</p>
                </div>
              </div>
            </div>

            {/* Difficulty Breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-6">Soal Berdasarkan Tingkat Kesulitan</h3>
              <div className="space-y-4">
                {[
                  { label: 'Mudah', count: displayAnalytics.difficulty_stats.easy.count, avg: displayAnalytics.difficulty_stats.easy.avg_correct_percentage, color: 'bg-emerald-500' },
                  { label: 'Sedang', count: displayAnalytics.difficulty_stats.medium.count, avg: displayAnalytics.difficulty_stats.medium.avg_correct_percentage, color: 'bg-amber-500' },
                  { label: 'Sulit', count: displayAnalytics.difficulty_stats.hard.count, avg: displayAnalytics.difficulty_stats.hard.avg_correct_percentage, color: 'bg-red-500' },
                ].map((item, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-slate-700">{item.label}</span>
                      <span className="text-slate-500">{item.count} soal · {item.avg}% benar</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.avg}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Cari siswa..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'score' | 'name')}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="score">Sortir: Nilai Tertinggi</option>
                  <option value="name">Sortir: Nama A-Z</option>
                </select>
              </div>
              <div className="text-sm text-slate-500">
                {filteredStudents.length} siswa
              </div>
            </div>

            {/* Table */}
            {loading ? (
              <TableSkeleton columns={5} rows={8} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Peringkat</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nama</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nilai</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Waktu</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((student, index) => {
                      const grade = getGrade(student.average_score);
                      return (
                        <tr key={student.student_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                              student.rank === 1 ? 'bg-amber-100 text-amber-700' :
                              student.rank === 2 ? 'bg-slate-200 text-slate-600' :
                              student.rank === 3 ? 'bg-pink-100 text-pink-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {student.rank}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium text-slate-800 flex items-center gap-2">
                                {student.student_name}
                                {student.attempt_status === 'auto_submitted' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700" title="Ujian ditutup otomatis oleh sistem (waktu habis / pelanggaran)">
                                    Waktu Habis
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-400">{student.student_email}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${grade.color}`}>
                                {grade.label}
                              </span>
                              <span className="font-semibold text-slate-800">{Math.round(student.average_score)}%</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {formatDuration(student.total_time_used_seconds / student.completed_exams)}
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => openStudentReview(student.attempt_id)}
                              disabled={!student.attempt_id}
                              title="Lihat jawaban siswa vs kunci jawaban"
                              className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Eye size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800">Analisis Soal</h3>
              <p className="text-sm text-slate-500">Performa setiap soal ujian</p>
            </div>
            <div className="divide-y divide-slate-100">
              {displayAnalytics.question_analytics.map((q, index) => (
                <div key={q.question_id} className="p-6">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleQuestion(q.question_id)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-bold text-slate-400">#{index + 1}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          q.difficulty === 'easy' ? 'bg-emerald-100 text-emerald-700' :
                          q.difficulty === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {q.difficulty === 'easy' ? 'Mudah' : q.difficulty === 'medium' ? 'Sedang' : 'Sulit'}
                        </span>
                        <span className="text-xs text-slate-400 capitalize">{q.question_type === 'mcq' ? 'Pilihan Ganda' : q.question_type}</span>
                      </div>
                      <p className="text-slate-800 font-medium mb-3">{q.question_text}</p>
                      <div className="flex items-center gap-6 text-sm">
                        <span className="text-emerald-600">{q.correct_count} benar</span>
                        <span className="text-red-500">{q.wrong_count} salah</span>
                        {q.unanswered_count > 0 && (
                          <span className="text-slate-400">{q.unanswered_count} kosong</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className={`text-2xl font-bold ${
                          q.correct_percentage >= 70 ? 'text-emerald-600' :
                          q.correct_percentage >= 40 ? 'text-amber-600' :
                          'text-red-500'
                        }`}>
                          {q.correct_percentage}%
                        </p>
                        <p className="text-xs text-slate-400">ketepatan</p>
                      </div>
                      {expandedQuestion === q.question_id ? (
                        <ChevronUp size={18} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={18} className="text-slate-400" />
                      )}
                    </div>
                  </div>

                  {expandedQuestion === q.question_id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 pt-4 border-t border-slate-100 space-y-5"
                    >
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl text-center">
                          <p className="text-2xl font-bold text-slate-800">{q.total_attempts}</p>
                          <p className="text-xs text-slate-500">Total Percobaan</p>
                        </div>
                        <div className="p-4 bg-emerald-50 rounded-xl text-center">
                          <p className="text-2xl font-bold text-emerald-600">{q.correct_count}</p>
                          <p className="text-xs text-emerald-600">Jawaban Benar</p>
                        </div>
                        <div className="p-4 bg-red-50 rounded-xl text-center">
                          <p className="text-2xl font-bold text-red-500">{q.wrong_count}</p>
                          <p className="text-xs text-red-500">Jawaban Salah</p>
                        </div>
                      </div>

                      {questionDetailLoading === q.question_id && (
                        <div className="flex items-center gap-2 text-sm text-slate-400 justify-center py-4">
                          <Loader2 size={16} className="animate-spin" /> Memuat jawaban peserta...
                        </div>
                      )}

                      {questionDetails[q.question_id] && (() => {
                        const detail = questionDetails[q.question_id];
                        const dq = detail.question;
                        const options: any[] = dq.options || [];
                        const answered = detail.responses.length || 1;
                        const keyLines = formatAnswerKey({ ...dq, options });
                        const isOptionBased = ['mcq', 'sjt', 'forced_choice', 'paired_comparison'].includes(dq.type);

                        return (
                          <div className="space-y-5">
                            {/* Distribusi pilihan per opsi (tipe pilihan tunggal) */}
                            {isOptionBased && options.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Distribusi Pilihan Jawaban</p>
                                <div className="space-y-2">
                                  {options.map((opt: any, oi: number) => {
                                    const count = detail.optionCounts[opt.id] || 0;
                                    const pct = Math.round((count / answered) * 100);
                                    return (
                                      <div key={opt.id} className={`flex items-center gap-3 p-2 rounded-lg border ${opt.is_correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100'}`}>
                                        <span className={`w-6 h-6 shrink-0 rounded flex items-center justify-center text-[11px] font-black ${opt.is_correct ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                          {String.fromCharCode(65 + oi)}
                                        </span>
                                        <span className="flex-1 min-w-0 text-sm text-slate-700 truncate" title={stripHtml(opt.option_text || '')}>
                                          {stripHtml(opt.option_text || '')}
                                        </span>
                                        <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                          <div className={`h-full rounded-full ${opt.is_correct ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="w-14 text-right text-xs font-semibold text-slate-600 shrink-0">{count} ({pct}%)</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Kunci jawaban */}
                            {keyLines.length > 0 && (
                              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                                <p className="text-xs font-bold text-emerald-600 uppercase mb-1.5">Kunci Jawaban</p>
                                <ul className="text-sm text-emerald-800 space-y-0.5">
                                  {keyLines.map((line, li) => <li key={li}>{line}</li>)}
                                </ul>
                              </div>
                            )}

                            {/* Jawaban tiap siswa */}
                            <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Jawaban Peserta ({detail.responses.length})</p>
                              <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50 max-h-80 overflow-y-auto">
                                {detail.responses.map((r: any, ri: number) => {
                                  const lines = formatStudentAnswer({ ...dq, options }, r.selectedOptionId, r.essayAnswer);
                                  return (
                                    <div key={ri} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                                      <span className="w-40 shrink-0 font-medium text-slate-700 truncate" title={r.studentName}>{r.studentName}</span>
                                      <div className="flex-1 min-w-0 text-slate-600">
                                        {lines.length > 0
                                          ? lines.map((line, li) => <p key={li} className="truncate" title={line}>{line}</p>)
                                          : <span className="italic text-slate-300">Tidak dijawab</span>}
                                      </div>
                                      <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${
                                        r.isCorrect === true ? 'bg-emerald-100 text-emerald-700' :
                                        r.isCorrect === false ? 'bg-red-100 text-red-600' :
                                        'bg-slate-100 text-slate-500'
                                      }`}>
                                        {r.isCorrect === true ? 'Benar' : r.isCorrect === false ? 'Salah' : `Skor ${r.score ?? '-'}`}
                                      </span>
                                    </div>
                                  );
                                })}
                                {detail.unanswered.length > 0 && (
                                  <div className="px-4 py-2.5 text-xs text-slate-400 bg-slate-50/50">
                                    Tidak menjawab: {detail.unanswered.join(', ')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Modal: Jawaban siswa vs kunci jawaban ── */}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setReviewOpen(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-slate-800">
                  {reviewData?.attempt?.profiles?.full_name || 'Detail Jawaban Siswa'}
                </h3>
                <p className="text-xs text-slate-400">
                  {reviewData?.attempt ? (
                    <>
                      Nilai: <span className="font-bold text-slate-600">{Math.round(Number(reviewData.attempt.total_score) || 0)}</span>
                      {reviewData.attempt.status === 'auto_submitted' && ' • Ditutup otomatis oleh sistem'}
                      {reviewData.attempt.needs_manual_grading && ' • Menunggu penilaian manual'}
                    </>
                  ) : 'Perbandingan jawaban siswa dan kunci jawaban'}
                </p>
              </div>
              <button onClick={() => setReviewOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                <XCircle size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {reviewLoading && (
                <div className="flex items-center justify-center gap-2 text-slate-400 py-16">
                  <Loader2 size={20} className="animate-spin" /> Memuat jawaban...
                </div>
              )}

              {!reviewLoading && !reviewData && (
                <p className="text-center text-sm text-slate-400 py-16">Data jawaban tidak ditemukan.</p>
              )}

              {!reviewLoading && reviewData?.answers?.map((ans: any, idx: number) => {
                const q = ans.question;
                const studentLines = formatStudentAnswer(q, ans.selectedOptionId, ans.essayAnswer);
                const keyLines = formatAnswerKey(q);
                return (
                  <div key={ans.id} className={`rounded-xl border overflow-hidden ${
                    ans.isCorrect === true ? 'border-emerald-100' : ans.isCorrect === false ? 'border-red-100' : 'border-slate-100'
                  }`}>
                    <div className={`px-4 py-2.5 flex items-center justify-between text-xs font-semibold ${
                      ans.isCorrect === true ? 'bg-emerald-50/60 text-emerald-700' :
                      ans.isCorrect === false ? 'bg-red-50/60 text-red-600' :
                      'bg-slate-50 text-slate-500'
                    }`}>
                      <span>Soal {idx + 1} • {q.type?.toUpperCase()}</span>
                      <span>
                        {ans.isCorrect === true ? '✓ Benar' : ans.isCorrect === false ? '✗ Salah' : 'Perlu penilaian'}
                        {' • '}Skor: {ans.score ?? '-'} / {q.score_default || 1}
                      </span>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="text-sm text-slate-800">
                        <LatexRenderer text={q.question_text || ''} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Jawaban Siswa</p>
                          {studentLines.length > 0
                            ? studentLines.map((line, li) => <p key={li} className="text-sm text-slate-700">{line}</p>)
                            : <p className="text-sm italic text-slate-300">Tidak dijawab</p>}
                        </div>
                        <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100/60">
                          <p className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Kunci Jawaban</p>
                          {keyLines.length > 0
                            ? keyLines.map((line, li) => <p key={li} className="text-sm text-emerald-800">{line}</p>)
                            : <p className="text-sm italic text-emerald-300">Dinilai manual / tanpa kunci objektif</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}