"use client";

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, PieChart, UserCheck, UserX } from 'lucide-react';
import { FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Button } from '@/app/components/ui/button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import type { ItemAnalysis } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';
import { getQuestionSnippet } from '@/lib/question-snippet';

const QUESTION_TYPE_INDONESIAN_LABELS: Record<string, string> = {
    mcq: 'PG',
    mcq_complex: 'PGK',
    true_false: 'B/S',
    matching: 'Menjodohkan',
    categorization: 'Kategori',
    short_answer: 'Isian',
    essay: 'Esai',
    uraian: 'Esai',
    esay: 'Esai',
    sjt: 'SJT',
    ordering: 'Urutan',
    likert: 'Likert',
    forced_choice: 'Pilihan Paksa',
    checklist: 'Ceklis',
    ranking: 'Peringkat',
    paired_comparison: 'Berpasangan',
};

export function formatQuestionType(type?: string): string {
    if (!type) return 'PG';
    const key = type.toLowerCase().trim();
    return QUESTION_TYPE_INDONESIAN_LABELS[key] || type.replace(/_/g, ' ').toUpperCase();
}

const ANALYSIS_PAGE_SIZE = 10;

/**
 * Tab Analisis monitoring: daftar butir soal (urut % salah tertinggi, 10 per
 * halaman) dan detail butir berisi teks soal, kunci, siswa benar/salah, serta
 * sebaran pengecoh. Dipakai monitoring ujian biasa dan monitoring ruang ASAS/AM.
 */
export function ItemAnalysisPanel({ analysis, className = '' }: { analysis: ItemAnalysis[]; className?: string }) {
    const [analysisPage, setAnalysisPage] = useState(1);
    const [viewQuestion, setViewQuestion] = useState<ItemAnalysis | null>(null);
    const [modalActiveTab, setModalActiveTab] = useState<'soal' | 'benar' | 'salah' | 'distraktor'>('soal');
    const [search, setSearch] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const query = search.trim().toLocaleLowerCase('id');
    const filteredAnalysis = analysis.filter(item =>
        (!difficulty || (item.difficultyLabel?.trim().toLocaleLowerCase('id') || 'unknown') === difficulty)
        && (!query || String(item.number) === query.replace(/^#/, '')
            || item.topic?.toLocaleLowerCase('id').includes(query)
            || getQuestionSnippet(item.qText, Number.MAX_SAFE_INTEGER).toLocaleLowerCase('id').includes(query)));
    const difficultyOptions = [...new Set(analysis.map(item => item.difficultyLabel?.trim()).filter((label): label is string => Boolean(label)))];
    const analysisTotalPages = Math.max(1, Math.ceil(filteredAnalysis.length / ANALYSIS_PAGE_SIZE));
    const safeAnalysisPage = Math.min(analysisPage, analysisTotalPages);
    const pagedAnalysis = filteredAnalysis.slice((safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE, safeAnalysisPage * ANALYSIS_PAGE_SIZE);
    const emptyText = analysis.length ? 'Tidak ada soal yang sesuai dengan pencarian atau filter.' : 'Belum ada data';

    return (
        <div className="monitoring-analysis-panel flex flex-col gap-4">
        <FilterToolbar>
            <FilterSearch value={search} onChange={value => { setSearch(value); setAnalysisPage(1); }}
                label="Cari soal" placeholder="Cari teks atau nomor soal…" />
            <FilterSelect value={difficulty} onChange={value => { setDifficulty(value); setAnalysisPage(1); }}
                label="Kesukaran" width="200px" grow={0}
                options={[{ value: '', label: 'Semua kesukaran' },
                    ...difficultyOptions.map(label => ({ value: label.toLocaleLowerCase('id'), label })),
                    ...(analysis.some(item => !item.difficultyLabel?.trim()) ? [{ value: 'unknown', label: 'Belum ditentukan' }] : [])]} />
        </FilterToolbar>
        <div className={`monitoring-analysis bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden ${className}`}>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-xs">
                <span className="font-semibold text-slate-700 truncate">Urut % salah tertinggi</span>
                {analysis.some(item => item.incorrectPercentage > 50) && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 shrink-0">
                        {analysis.filter(item => item.incorrectPercentage > 50).length} perlu ditinjau
                    </span>
                )}
            </div>
            {/* mobile analysis cards - ringkas, tinggi terkontrol */}
            <div className="monitoring-analysis__mobile sm:hidden divide-y divide-slate-100">
                {filteredAnalysis.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 font-medium text-xs">{emptyText}</div>
                ) : (
                    pagedAnalysis.map((anl) => {
                        const isCritical = anl.incorrectPercentage > 50;

                        return (
                            <button
                                key={anl.id}
                                type="button"
                                onClick={() => {
                                    setViewQuestion(anl);
                                    setModalActiveTab('soal');
                                }}
                                className={`w-full p-3 flex items-start gap-3 text-left transition-colors active:bg-slate-100 ${
                                    isCritical ? 'bg-amber-50/25 hover:bg-amber-50/40' : 'bg-white hover:bg-slate-50'
                                }`}
                            >
                                <div className="w-[72px] shrink-0 text-left">
                                    <div className="text-xs font-bold text-slate-800">
                                        #{anl.number}
                                    </div>
                                    <div className={`mt-0.5 text-[11px] font-semibold tabular-nums ${
                                        isCritical ? 'text-rose-600' : 'text-emerald-600'
                                    }`}>
                                        {anl.incorrectPercentage.toFixed(0)}% salah
                                    </div>
                                </div>
                                <div className="min-w-0 flex-1 text-left">
                                    <div className="mb-1 text-[11px] text-slate-500">{anl.topic && <span className="block font-medium">{anl.topic}</span>}{formatQuestionType(anl.type)} · {anl.difficultyLabel || 'Kesukaran belum ditentukan'}</div>
                                    <LatexRenderer
                                        text={getQuestionSnippet(anl.qText, 95)}
                                        className="!font-sans !text-xs !leading-relaxed !text-left text-slate-700 line-clamp-2 [&_.katex]:!text-[11px]"
                                    />
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full min-w-[700px]">
                    <thead>
                        <tr className="bg-[#3083FF]/5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                            <th className="p-4 text-center font-bold text-[#3083FF] w-14">No</th>
                            <th className="p-4 text-left font-bold text-[#3083FF]">Soal</th>
                            <th className="p-4 text-center font-bold text-[#3083FF] w-20">Tipe</th>
                            <th className="p-4 text-center font-bold text-[#3083FF] w-28">Kesukaran</th>
                            <th className="p-4 text-center font-bold text-[#3083FF]">Menjawab</th>
                            <th className="p-4 text-center font-bold text-[#3083FF]">Benar</th>
                            <th className="p-4 text-center font-bold text-[#3083FF]">Salah</th>
                            <th className="p-4 text-center font-bold text-[#3083FF]">Belum Ternilai</th>
                            <th className="p-4 text-right font-bold text-[#3083FF]">% Salah</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAnalysis.length === 0 ? (
                            <tr><td colSpan={9} className="p-12 text-center text-slate-400 font-medium">{emptyText}</td></tr>
                        ) : (
                            pagedAnalysis.map((anl) => {
                                const isCritical = anl.incorrectPercentage > 50;
                                const diffLabel = anl.difficultyLabel?.toLowerCase() || '';
                                const diffColor =
                                    diffLabel === 'mudah'
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : diffLabel === 'sukar'
                                        ? 'bg-red-50 text-red-700 border-red-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200';

                                return (
                                    <tr key={anl.id} className={`border-b border-[#3083FF]/10 last:border-0 ${isCritical ? 'bg-amber-50/40' : 'hover:bg-slate-50/40'} transition-colors`}>
                                        <td className="p-4 text-center font-bold text-[#3083FF] text-[11px]">{anl.number}</td>
                                        <td className="p-4">
                                            <div className="min-w-0">
                                                {anl.topic && <p className="mb-1 text-[11px] font-medium text-blue-700">Materi: {anl.topic}</p>}
                                                <div className="relative max-h-[3.5rem] overflow-hidden font-medium text-slate-700 [mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]">
                                                    <LatexRenderer text={anl.qText} className="!text-[12px] !leading-relaxed" />
                                                </div>
                                                {isCritical && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Mayoritas salah</span>}
                                                <button
                                                    onClick={() => {
                                                        setViewQuestion(anl);
                                                        setModalActiveTab('soal');
                                                    }}
                                                    className="mt-2 block text-left text-[11px] font-semibold text-[#3083FF] transition-colors hover:text-[#2563EB]"
                                                >
                                                    Detail Jawaban
                                                </button>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] font-bold uppercase text-slate-600">
                                                {formatQuestionType(anl.type)}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            {anl.difficultyLabel ? (
                                                <span className={`px-2 py-0.5 border rounded text-[11px] font-bold uppercase ${diffColor}`}>
                                                    {anl.difficultyLabel}
                                                </span>
                                            ) : (
                                                <span className="text-[11px] text-slate-400">-</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center font-bold text-slate-500 text-[11px]">{anl.total}</td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => {
                                                    setViewQuestion(anl);
                                                    setModalActiveTab('benar');
                                                }}
                                                className="px-2.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold transition-all text-[11px]"
                                                title="Klik untuk melihat siswa yang menjawab benar"
                                            >
                                                {anl.correct}
                                            </button>
                                        </td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => {
                                                    setViewQuestion(anl);
                                                    setModalActiveTab('salah');
                                                }}
                                                className="px-2.5 py-0.5 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold transition-all text-[11px]"
                                                title="Klik untuk melihat siswa yang menjawab salah"
                                            >
                                                {anl.incorrect}
                                            </button>
                                        </td>
                                        <td className="p-4 text-center"><span className="font-bold text-slate-400 text-[11px]">{anl.ungraded ?? 0}</span></td>
                                        <td className="p-4 text-right">
                                            <div className="flex flex-col items-end">
                                                <span className={`font-bold text-[11px] ${isCritical ? 'text-red-600' : 'text-[#3083FF]'}`}>{anl.incorrectPercentage.toFixed(0)}%</span>
                                                <div className="w-20 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                    <div className={`h-full rounded-full ${isCritical ? 'bg-red-500' : 'bg-[#3083FF]'}`} style={{ width: `${anl.incorrectPercentage}%` }} />
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
            {filteredAnalysis.length > ANALYSIS_PAGE_SIZE && (
                <div className="monitoring-analysis__pagination px-3.5 sm:px-5 py-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                    <span className="text-slate-500 font-medium tabular-nums">
                        {(safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE + 1}–{Math.min(safeAnalysisPage * ANALYSIS_PAGE_SIZE, filteredAnalysis.length)} dari {filteredAnalysis.length} soal
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setAnalysisPage(p => Math.max(1, p - 1))}
                            disabled={safeAnalysisPage <= 1}
                            className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-all"
                        >
                            Sebelumnya
                        </button>
                        <span className="px-1 font-semibold tabular-nums text-slate-600">{safeAnalysisPage} / {analysisTotalPages}</span>
                        <button
                            type="button"
                            onClick={() => setAnalysisPage(p => Math.min(analysisTotalPages, p + 1))}
                            disabled={safeAnalysisPage >= analysisTotalPages}
                            className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-all"
                        >
                            Berikutnya
                        </button>
                    </div>
                </div>
            )}
        </div>
        {/* VIEW QUESTION MODAL */}
        <Modal
            open={Boolean(viewQuestion)}
            onClose={() => setViewQuestion(null)}
            size="xl"
            variant="default"
            labelledBy="modal-view-question-title"
            className="h-[88dvh] max-h-[88dvh] flex flex-col"
        >
            {viewQuestion && (
                <>
                    {/* Modal Header */}
                    <ModalHeader
                        id="modal-view-question-title"
                        onClose={() => setViewQuestion(null)}
                        title={
                            <div className="flex flex-wrap items-center gap-2">
                                <span>Detail Butir Soal{viewQuestion.number ? ` No. ${viewQuestion.number}` : ''}</span>
                                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold uppercase tracking-wider">
                                    {formatQuestionType(viewQuestion.type)}
                                </span>
                                <span className={`px-2.5 py-0.5 border rounded-full text-[11px] font-bold tracking-wider ${viewQuestion.incorrectPercentage > 50 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                    {viewQuestion.incorrectPercentage.toFixed(0)}% salah
                                </span>
                                {viewQuestion.difficultyLabel && (
                                    <span className={`px-2.5 py-0.5 border rounded-full text-[11px] font-bold uppercase tracking-wider ${
                                        viewQuestion.difficultyLabel === 'Sukar' ? 'bg-red-50 text-red-700 border-red-200' :
                                        viewQuestion.difficultyLabel === 'Sedang' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                        'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    }`}>
                                        {viewQuestion.difficultyLabel} {viewQuestion.difficultyIndex !== undefined ? `(P: ${viewQuestion.difficultyIndex.toFixed(2)})` : ''}
                                    </span>
                                )}
                            </div>
                        }
                    />

                    {/* Modal Tabs Bar */}
                    <div className="shrink-0 px-4 sm:px-6 pt-2 border-b border-slate-200 bg-white flex items-center gap-2 overflow-x-auto">
                            <button
                                onClick={() => setModalActiveTab('soal')}
                                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                    modalActiveTab === 'soal'
                                        ? 'border-[#3083FF] text-[#3083FF]'
                                        : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Eye size={14} />
                                Teks Soal & Kunci
                            </button>
                            <button
                                onClick={() => setModalActiveTab('benar')}
                                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                    modalActiveTab === 'benar'
                                        ? 'border-emerald-500 text-emerald-600'
                                        : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <UserCheck size={14} className="text-emerald-500" />
                                Siswa Benar
                                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">
                                    {viewQuestion.correctStudents?.length ?? viewQuestion.correct}
                                </span>
                            </button>
                            <button
                                onClick={() => setModalActiveTab('salah')}
                                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                    modalActiveTab === 'salah'
                                        ? 'border-red-500 text-red-600'
                                        : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <UserX size={14} className="text-red-500" />
                                Siswa Salah
                                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-100 text-red-700">
                                    {viewQuestion.wrongStudents?.length ?? viewQuestion.incorrect}
                                </span>
                            </button>
                            {(viewQuestion.distractorDistribution?.length ?? 0) > 0 && (
                                <button
                                    onClick={() => setModalActiveTab('distraktor')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'distraktor'
                                            ? 'border-purple-500 text-purple-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <PieChart size={14} className="text-purple-500" />
                                    Sebaran Pengecoh
                                </button>
                            )}
                        </div>

                        {/* Modal Content */}
                    <ModalBody className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-50/30">
                            {modalActiveTab === 'soal' && (
                                <div className="space-y-5">
                                    <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Teks Soal</div>
                                        <LatexRenderer text={viewQuestion.qText} className="text-base text-slate-800 leading-relaxed" />
                                    </div>

                                    {(viewQuestion.options?.length ?? 0) > 0 && (
                                        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pilihan Opsi & Kunci Jawaban</div>
                                            <div className="space-y-2">
                                                {viewQuestion.options.map((opt, i) => (
                                                    <div
                                                        key={opt.id || i}
                                                        className={`flex items-start gap-3 p-3 rounded-lg border text-sm transition-colors ${
                                                            opt.is_correct
                                                                ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-300'
                                                                : 'bg-slate-50 border-slate-200/70'
                                                        }`}
                                                    >
                                                        <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                            opt.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                                                        }`}>
                                                            {String.fromCharCode(65 + i)}
                                                        </span>
                                                        <div className="flex-1 min-w-0 pt-0.5">
                                                            <LatexRenderer text={opt.option_text || ''} className="!text-sm !leading-relaxed" />
                                                        </div>
                                                        {opt.is_correct && (
                                                            <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                                                <CheckCircle2 size={13} /> Kunci Jawaban
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {viewQuestion.keyDisplay && (
                                        <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-200 flex items-center justify-between text-xs text-blue-900">
                                            <span className="font-semibold">Kunci Jawaban Resmi:</span>
                                            <div className="font-bold bg-white px-3 py-1 rounded border border-blue-200">
                                                <LatexRenderer text={viewQuestion.keyDisplay} className="!font-sans !text-xs !leading-normal [&_p]:!m-0 [&_p]:inline" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                                        <div className="bg-white p-3 rounded-xl border border-slate-200">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase">Total Menjawab</div>
                                            <div className="text-xl font-bold text-slate-700 mt-1">{viewQuestion.total}</div>
                                        </div>
                                        <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                                            <div className="text-[10px] font-bold text-emerald-600 uppercase">Jawaban Benar</div>
                                            <div className="text-xl font-bold text-emerald-700 mt-1">{viewQuestion.correct}</div>
                                        </div>
                                        <div className="bg-red-50 p-3 rounded-xl border border-red-200">
                                            <div className="text-[10px] font-bold text-red-600 uppercase">Jawaban Salah</div>
                                            <div className="text-xl font-bold text-red-700 mt-1">{viewQuestion.incorrect}</div>
                                        </div>
                                        <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                                            <div className="text-[10px] font-bold text-amber-600 uppercase">Belum Dinilai</div>
                                            <div className="text-xl font-bold text-amber-700 mt-1">{viewQuestion.ungraded ?? 0}</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {modalActiveTab === 'benar' && (
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="p-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 size={16} className="text-emerald-600" />
                                            <span className="font-bold text-sm text-emerald-900">
                                                Daftar Siswa yang Menjawab Benar ({viewQuestion.correctStudents?.length ?? 0})
                                            </span>
                                        </div>
                                        <span className="text-xs text-emerald-700 font-medium">Nilai Poin Diperoleh Penuh</span>
                                    </div>

                                    {(!viewQuestion.correctStudents || viewQuestion.correctStudents.length === 0) ? (
                                        <div className="p-8 text-center text-slate-400 text-sm">
                                            Belum ada siswa yang menjawab dengan benar untuk butir soal ini.
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto max-h-[50vh]">
                                            <table className="w-full text-left border-collapse text-xs">
                                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                    <tr>
                                                        <th className="p-3 w-12 text-center">No</th>
                                                        <th className="p-3">Nama Siswa</th>
                                                        <th className="p-3">Kelas</th>
                                                        <th className="p-3">NISN / Identitas</th>
                                                        <th className="p-3">Jawaban Diberikan</th>
                                                        <th className="p-3 text-right">Skor</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {viewQuestion.correctStudents.map((st, i) => (
                                                        <tr key={i} className="hover:bg-emerald-50/30 transition-colors">
                                                            <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                            <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                            <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                            <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                            <td className="p-3">
                                                                <div className="inline-block max-w-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                                                                    <LatexRenderer text={st.display_answer || 'Benar'} className="!font-sans !text-[11px] !leading-normal [&_p]:!m-0 [&_p]:inline" />
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-right font-bold text-emerald-600">
                                                                +{st.score !== undefined ? st.score : 1}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {modalActiveTab === 'salah' && (
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="p-4 bg-red-50/50 border-b border-red-100 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle size={16} className="text-red-600" />
                                            <span className="font-bold text-sm text-red-900">
                                                Daftar Siswa yang Menjawab Salah ({viewQuestion.wrongStudents?.length ?? 0})
                                            </span>
                                        </div>
                                        <span className="text-xs text-red-700 font-medium">Perlu Perhatian & Remedial</span>
                                    </div>

                                    {(!viewQuestion.wrongStudents || viewQuestion.wrongStudents.length === 0) ? (
                                        <div className="p-8 text-center text-emerald-600 font-medium text-sm">
                                            Luar biasa! Tidak ada siswa yang menjawab salah untuk butir soal ini.
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto max-h-[50vh]">
                                            <table className="w-full text-left border-collapse text-xs">
                                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                    <tr>
                                                        <th className="p-3 w-12 text-center">No</th>
                                                        <th className="p-3">Nama Siswa</th>
                                                        <th className="p-3">Kelas</th>
                                                        <th className="p-3">NISN / Identitas</th>
                                                        <th className="p-3">Jawaban Siswa</th>
                                                        <th className="p-3">Kunci Jawaban</th>
                                                        <th className="p-3 text-right">Skor</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {viewQuestion.wrongStudents.map((st, i) => (
                                                        <tr key={i} className="hover:bg-red-50/30 transition-colors">
                                                            <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                            <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                            <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                            <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                            <td className="p-3">
                                                                <div className="inline-block max-w-xs px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                                                                    <LatexRenderer text={st.display_answer || '(Kosong / Salah)'} className="!font-sans !text-[11px] !leading-normal [&_p]:!m-0 [&_p]:inline" />
                                                                </div>
                                                            </td>
                                                            <td className="p-3">
                                                                <div className="inline-block max-w-xs px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px]">
                                                                    <LatexRenderer text={viewQuestion.keyDisplay || '-'} className="!font-sans !text-[11px] !leading-normal [&_p]:!m-0 [&_p]:inline" />
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-right font-bold text-red-500">
                                                                {st.score !== undefined ? st.score : 0}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {modalActiveTab === 'distraktor' && (
                                <div className="space-y-4">
                                    <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-200 flex items-center justify-between text-xs text-purple-900">
                                        <span className="font-semibold">Analisis Distribusi Pemilihan Opsi (Pengecoh / Distractor):</span>
                                        <span className="text-[11px] text-purple-700">Membantu mengevaluasi efektivitas distraktor soal</span>
                                    </div>

                                    <div className="space-y-3">
                                        {(viewQuestion.distractorDistribution || []).map((dist) => (
                                            <div key={dist.option_id} className={`p-4 rounded-xl border transition-all ${
                                                dist.is_correct ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-slate-200'
                                            }`}>
                                                <div className="flex items-center justify-between gap-4 mb-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                            dist.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                                        }`}>
                                                            {dist.option_letter}
                                                        </span>
                                                        <div className="min-w-0 truncate text-xs text-slate-700 font-medium">
                                                            {dist.option_text ? (
                                                                <LatexRenderer text={getQuestionSnippet(dist.option_text, 80)} className="!font-sans !text-xs !leading-normal !text-left truncate [&_p]:!m-0 [&_p]:inline" />
                                                            ) : ''}
                                                        </div>
                                                        {dist.is_correct && (
                                                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                                                KUNCI
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <span className="font-bold text-sm text-slate-800">{dist.count} siswa</span>
                                                        <span className="text-xs text-slate-500 ml-1.5 font-semibold">({dist.percentage.toFixed(1)}%)</span>
                                                    </div>
                                                </div>

                                                {/* Progress bar */}
                                                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            dist.is_correct ? 'bg-emerald-500' : 'bg-[#3083FF]'
                                                        }`}
                                                        style={{ width: `${Math.min(100, dist.percentage)}%` }}
                                                    />
                                                </div>

                                                {/* Students who selected this option */}
                                                {dist.student_names && dist.student_names.length > 0 && (
                                                    <div className="pt-2 border-t border-slate-100">
                                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                            Siswa yang Memilih:
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {dist.student_names.map((nm: string, sIdx: number) => (
                                                                <span
                                                                    key={sIdx}
                                                                    className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                                                                        dist.is_correct
                                                                            ? 'bg-emerald-100/70 text-emerald-800'
                                                                            : 'bg-slate-100 text-slate-700'
                                                                    }`}
                                                                >
                                                                    {formatStudentName(nm, 'Tanpa Nama')}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </ModalBody>

                    {/* Modal Footer */}
                    <ModalFooter align="between">
                        <div className="text-xs text-slate-500">
                            {viewQuestion.discriminationLabel && (
                                <span>Daya Beda: <strong className="text-slate-700">{viewQuestion.discriminationLabel}</strong> ({viewQuestion.discriminationIndex?.toFixed(2) ?? '-'})</span>
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => setViewQuestion(null)}
                        >
                            Tutup
                        </Button>
                    </ModalFooter>
                </>
            )}
        </Modal>
        </div>
    );
}
