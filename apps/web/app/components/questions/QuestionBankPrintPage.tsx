"use client";

import { getBankQuestions, getQuestionBankAction, type QuestionBank, type QuestionRecord } from '@/lib/api/questions';
import { analyzePrintQuestions, exportBaseName, formatNumberList } from '@/lib/exam-print-model';
import { usePrintFit } from '@/lib/usePrintFit';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, Printer, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ExamPrintView = dynamic(() => import('@/app/components/questions/ExamPrintView').then(mod => mod.ExamPrintView), { ssr: false });

type QuestionBankRole = 'admin' | 'guru' | 'proktor';

interface Props {
    role: QuestionBankRole;
}

interface Notice {
    level: 'warning' | 'info';
    text: string;
}

/**
 * Halaman "Lembar Ujian (PDF)". Berdiri sendiri — tanpa sidebar, header, atau
 * bottom nav — sehingga hasil cetak hanya berisi lembar soal.
 */
export default function QuestionBankPrintPage({ role }: Props) {
    const params = useParams();
    const bankId = params.bankId as string;
    const questionsBasePath = `/dashboard/${role}/questions`;

    const [bank, setBank] = useState<QuestionBank | null>(null);
    const [questions, setQuestions] = useState<QuestionRecord[]>([]);
    const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
    const [showDetails, setShowDetails] = useState(false);
    const sheetRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let active = true;
        void Promise.all([getQuestionBankAction(bankId), getBankQuestions(bankId)])
            .then(([bankDetail, list]) => {
                if (!active) return;
                setBank(bankDetail);
                setQuestions(list || []);
                setState(bankDetail ? 'ready' : 'missing');
            })
            .catch(() => { if (active) setState('missing'); });
        return () => { active = false; };
    }, [bankId]);

    // Lembar cetak selalu bertema terang: aturan warna mode gelap aplikasi
    // (teks pudar, kepala tabel gelap) tidak boleh ikut ke kertas/PDF.
    useLayoutEffect(() => {
        const root = document.documentElement;
        const wasDark = root.classList.contains('dark');
        const previousScheme = root.style.colorScheme;
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
        return () => {
            if (wasDark) root.classList.add('dark');
            root.style.colorScheme = previousScheme;
        };
    }, []);

    // Nama berkas bawaan "Simpan sebagai PDF" mengikuti judul dokumen.
    useEffect(() => {
        if (!bank) return;
        const previous = document.title;
        document.title = exportBaseName('sheet', bank.title || bank.name);
        return () => { document.title = previous; };
    }, [bank]);

    const contentKey = useMemo(
        () => `${bankId}:${questions.map(q => `${q.id}:${q.revision ?? q.updated_at ?? ''}`).join('|')}`,
        [bankId, questions],
    );
    const { report, relayout } = usePrintFit(sheetRef, state === 'ready' ? contentKey : 'loading');

    const notices = useMemo<Notice[]>(() => {
        if (state !== 'ready') return [];
        const list: Notice[] = analyzePrintQuestions(questions).map(issue => ({
            level: issue.level,
            text: `${issue.message} — soal ${formatNumberList(issue.numbers)}`,
        }));
        if (report.status === 'ready') {
            if (report.brokenImages.length) list.unshift({ level: 'warning', text: `Gambar gagal dimuat — soal ${formatNumberList(report.brokenImages)}` });
            if (report.stillOverflowing.length) list.unshift({ level: 'warning', text: `Isi masih lebih lebar dari kertas — soal ${formatNumberList(report.stillOverflowing)}` });
            if (report.timedOut) list.push({ level: 'info', text: 'Sebagian isi terlambat dimuat; tata letak tetap dihitung ulang saat mencetak.' });
            report.scaled.forEach(({ number, percent }) => list.push({ level: 'info', text: `Soal ${number}: rumus/tabel/gambar diperkecil ke ${percent}% agar muat di A4` }));
        }
        return list;
    }, [questions, report, state]);
    const warningCount = notices.filter(n => n.level === 'warning').length;

    const handlePrint = () => {
        relayout();
        window.print();
    };

    if (state === 'loading') {
        return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin mr-2" /> Menyiapkan dokumen cetak…</div>;
    }
    if (state === 'missing' || !bank) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-100 text-sm text-slate-600">
                Bank soal tidak tersedia atau Anda tidak memiliki akses.
                <Link href={questionsBasePath} className="font-semibold text-primary">Kembali ke Bank Soal</Link>
            </div>
        );
    }

    const preparing = report.status === 'preparing';

    return (
        <div className="exam-print-page min-h-screen bg-slate-200 flex flex-col print:block print:min-h-0 print:bg-white">
            <div className="print:hidden shrink-0 bg-white border-b border-slate-300 sticky top-0 z-50 shadow-sm">
                <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-800 truncate">Pratinjau Cetak — {bank.title || 'Bank Soal'}</h2>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            {preparing
                                ? <><Loader2 size={12} className="animate-spin" /> Menata halaman A4…</>
                                : <><CheckCircle2 size={12} className="text-emerald-600" /> Siap cetak · ±{report.pages} halaman A4</>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {notices.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowDetails(v => !v)}
                                aria-expanded={showDetails}
                                className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 border transition-colors ${warningCount ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                            >
                                {warningCount ? <AlertTriangle size={14} /> : <Info size={14} />}
                                {warningCount ? `${warningCount} perlu dicek` : `${notices.length} catatan`}
                                <ChevronDown size={12} className={showDetails ? 'rotate-180 transition-transform' : 'transition-transform'} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handlePrint}
                            disabled={preparing}
                            className="px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-wait transition-all flex items-center gap-2"
                        >
                            {preparing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Cetak / Simpan PDF
                        </button>
                        <button
                            type="button"
                            onClick={() => window.close()}
                            className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-all flex items-center gap-1.5"
                            title="Tutup tab"
                        >
                            <X size={14} /> <span className="hidden sm:inline">Tutup</span>
                        </button>
                    </div>
                </div>
                {showDetails && notices.length > 0 && (
                    <ul className="px-4 sm:px-6 pb-3 space-y-1 max-h-48 overflow-y-auto">
                        {notices.map((notice, i) => (
                            <li key={i} className={`text-xs flex items-start gap-2 ${notice.level === 'warning' ? 'text-amber-800' : 'text-slate-600'}`}>
                                {notice.level === 'warning' ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : <Info size={12} className="mt-0.5 shrink-0" />}
                                {notice.text}
                            </li>
                        ))}
                    </ul>
                )}
                <p className="px-4 sm:px-6 pb-2 text-[11px] text-slate-400">
                    Di dialog cetak: kertas <strong>A4</strong>, skala <strong>Default/100%</strong>, dan aktifkan <strong>Grafik latar belakang</strong>.
                </p>
            </div>

            <div className="flex-1 p-4 sm:p-8 overflow-x-auto print:p-0 print:overflow-visible">
                <div className="w-[210mm] mx-auto bg-white shadow-xl print:shadow-none print:w-auto print:mx-0">
                    <ExamPrintView bankInfo={bank} questions={questions} rootRef={sheetRef} />
                </div>
            </div>
        </div>
    );
}
