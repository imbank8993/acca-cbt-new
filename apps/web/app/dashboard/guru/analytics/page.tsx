"use client";
import { motion } from 'framer-motion';
import {
Award,
BarChart3,
CheckCircle2,
ChevronRight,
Clock,FileText,
Target,
Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

// Dynamic import untuk komponen berat
import { CardSkeleton,ListSkeleton } from '@/app/components/ui/SkeletonPatterns';
import { getExamsWithStats } from '@/lib/api/analytics';
import { getProctorOrganization } from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import dynamic from 'next/dynamic';

const StatsGrid = dynamic(
  () => import('@/app/components/ui/Charts').then(mod => ({ default: mod.StatsGrid })),
  { loading: () => <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /></div> }
);
const StatCard = dynamic(
  () => import('@/app/components/ui/Charts').then(mod => ({ default: mod.StatCard })),
  { ssr: false, loading: () => <div className="bg-white p-6 rounded-2xl border border-slate-200 animate-pulse"><div className="h-4 bg-slate-100 rounded w-1/2 mb-2"></div><div className="h-8 bg-slate-100 rounded w-3/4"></div></div> }
);

interface ExamWithStats {
  id: string;
  title: string;
  status: string;
  is_published?: boolean;
  total_attempts: number;
  completed_attempts: number;
  average_score: number;
  created_at: string;
  question_banks?: { title: string };
}

export default function AnalyticsDashboard() {
  const [loading, setLoading] = useMemoryState('guru_analytics_loading', true);
  const [exams, setExams] = useMemoryState<ExamWithStats[]>('guru_analytics_exams', []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const user = await getSessionUser();
        if (!user) return;
        const org = await getProctorOrganization();
        if (!org) return;

        // getExamsWithStats sudah ter-scoping di server: Guru hanya menerima
        // ujian buatannya sendiri.
        const examsData = await getExamsWithStats();
        setExams((examsData as ExamWithStats[]) || []);
      } catch (error) {
        console.error('Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [setExams, setLoading]);

  // Statistik dihitung dari daftar ujian yang sudah ter-scoping — konsisten
  // dengan apa yang guru lihat di daftar, tanpa angka org-wide.
  const totalExams = exams.length;
  const activeExams = exams.filter(e => e.status === 'active' && e.is_published !== false).length;
  const totalAttempts = exams.reduce((sum, e) => sum + (e.total_attempts || 0), 0);
  const completedAttempts = exams.reduce((sum, e) => sum + (e.completed_attempts || 0), 0);
  const completionRate = totalAttempts > 0 ? Math.round((completedAttempts / totalAttempts) * 100) : 0;
  const scoredExams = exams.filter(e => (e.completed_attempts || 0) > 0);
  const averageScore = scoredExams.length > 0
    ? Math.round(
        scoredExams.reduce((sum, e) => sum + (e.average_score || 0) * (e.completed_attempts || 0), 0) /
        Math.max(1, scoredExams.reduce((sum, e) => sum + (e.completed_attempts || 0), 0))
      )
    : 0;

  const recentExams = exams.slice(0, 8);

  const statusLabel = (e: ExamWithStats) => {
    if (!e.is_published) return { text: 'Draft', cls: 'bg-amber-100 text-amber-700', icon: 'bg-amber-100 text-amber-600' };
    if (e.status === 'active') return { text: 'Aktif', cls: 'bg-emerald-100 text-emerald-700', icon: 'bg-emerald-100 text-emerald-600' };
    return { text: 'Selesai', cls: 'bg-slate-100 text-slate-600', icon: 'bg-slate-100 text-slate-600' };
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BarChart3 size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Analitik & Statistik</h1>
              <p className="text-sm text-slate-500">Performa ujian yang Anda buat</p>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Stats Grid */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
            Ringkasan
          </h2>
          <StatsGrid>
            <StatCard
              title="Total Ujian"
              value={totalExams}
              icon={<FileText size={20} />}
              loading={loading}
            />
            <StatCard
              title="Ujian Aktif"
              value={activeExams}
              icon={<Clock size={20} />}
              loading={loading}
            />
            <StatCard
              title="Rata-rata Nilai"
              value={`${averageScore}`}
              icon={<Target size={20} />}
              loading={loading}
            />
            <StatCard
              title="Tingkat Penyelesaian"
              value={`${completionRate}%`}
              icon={<Award size={20} />}
              loading={loading}
            />
          </StatsGrid>
        </section>

        {/* Quick Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Total Pengerjaan</p>
                <p className="text-xs text-slate-400">Seluruh ujian Anda</p>
              </div>
            </div>
            <p className="text-xl font-bold text-slate-800">{totalAttempts}</p>
          </div>
          <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Selesai Mengerjakan</p>
                <p className="text-xs text-slate-400">dari total pengerjaan</p>
              </div>
            </div>
            <p className="text-xl font-bold text-slate-800">{completedAttempts}</p>
          </div>
        </section>

        {/* Recent Exams */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-800">Ujian Terbaru</h3>
              <p className="text-sm text-slate-500">Aktivitas ujian terkini</p>
            </div>
            <Link
              href="/dashboard/guru/exams"
              className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Lihat Semua
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              <ListSkeleton items={5} avatar={false} />
            ) : recentExams.length === 0 ? (
              <div className="px-6 py-10 text-center text-slate-400 text-sm">
                Belum ada ujian. Buat ujian dulu di menu Ujian.
              </div>
            ) : (
              recentExams.map((exam, index) => {
                const st = statusLabel(exam);
                return (
                  <motion.div
                    key={exam.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${st.icon}`}>
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{exam.title}</p>
                        <p className="text-sm text-slate-400 truncate">{exam.question_banks?.title || '-'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-right">
                        <p className="font-medium text-slate-800">{exam.average_score}</p>
                        <p className="text-xs text-slate-400">Rata-rata</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-slate-800">{exam.completed_attempts}/{exam.total_attempts}</p>
                        <p className="text-xs text-slate-400">Peserta</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.cls}`}>
                        {st.text}
                      </span>
                      <Link
                        href={`/dashboard/guru/analytics/exam/${exam.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <ChevronRight size={18} />
                      </Link>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
