"use client";

import React, { useState, useEffect } from 'react';
import {
    Printer,
    X,
    ShieldCheck,
    CheckCircle2,
    AlertCircle,
    Clock,
    XCircle,
    FileText,
    Loader2,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import {
    getValidationReviewData,
    type ValidationSession,
    type ValidationNote,
    type ValidationValidator,
} from '@/lib/api/validations';
import type { QuestionRecord } from '@/lib/api/questions';

interface ValidationReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    validationId: string;
}

export function ValidationReportModal({
    isOpen,
    onClose,
    validationId,
}: ValidationReportModalProps) {
    const [loading, setLoading] = useState(true);
    const [validation, setValidation] = useState<ValidationSession | null>(null);
    const [questions, setQuestions] = useState<QuestionRecord[]>([]);
    const [notes, setNotes] = useState<ValidationNote[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !validationId) return;
        setLoading(true);
        setError(null);

        getValidationReviewData(validationId)
            .then(res => {
                if (res) {
                    setValidation(res.validation);
                    setQuestions(res.questions || []);
                    setNotes(res.notes || []);
                } else {
                    setError('Gagal memuat data laporan validasi.');
                }
            })
            .catch(err => {
                setError(err.message || 'Gagal memuat data laporan validasi.');
            })
            .finally(() => setLoading(false));
    }, [isOpen, validationId]);

    if (!isOpen) return null;

    const handlePrint = () => {
        window.print();
    };

    // Helper untuk mencari nomor urut soal berdasarkan question_id
    const getQuestionNumber = (qId: string) => {
        const idx = questions.findIndex(q => q.id === qId);
        return idx >= 0 ? idx + 1 : '-';
    };

    const getStatusLabel = (status?: string | null) => {
        switch (status) {
            case 'approved':
                return 'Disetujui (Valid)';
            case 'revision_needed':
                return 'Perlu Revisi';
            case 'rejected':
                return 'Ditolak';
            case 'in_progress':
                return 'Sedang Divalidasi';
            default:
                return 'Menunggu';
        }
    };

    const getRecommendationLabel = (rec?: string | null) => {
        switch (rec) {
            case 'approved':
                return 'Disetujui (Valid)';
            case 'revision_needed':
                return 'Perlu Revisi';
            case 'rejected':
                return 'Ditolak';
            default:
                return '-';
        }
    };

    const getCategoryLabel = (category?: string) => {
        switch (category) {
            case 'key_correction':
                return 'Koreksi Kunci Jawaban';
            case 'typo':
                return 'Kesalahan Penulisan (Typo)';
            case 'ambiguous':
                return 'Soal Ambigu / Kurang Jelas';
            case 'stimulus_issue':
                return 'Masalah Stimulus / Gambar';
            default:
                return 'Penyempurnaan';
        }
    };

    const getScopeLabel = (scope?: string) => {
        switch (scope) {
            case 'question_text':
                return 'Pertanyaan / Soal';
            case 'option':
                return 'Opsi Jawaban';
            case 'stimulus':
                return 'Stimulus';
            default:
                return 'Umum';
        }
    };

    const todayDateFormatted = new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in print:p-0 print:bg-white print:static">
            {/* Modal Dialog Container */}
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-screen sm:max-h-[92vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden print:max-h-none print:shadow-none print:w-full print:rounded-none">
                {/* Header (Hidden on Print) */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 print:hidden bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2.5">
                        <FileText size={20} className="text-primary" />
                        <div>
                            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                                Pratinjau Laporan Validasi Butir Soal
                            </h3>
                            <p className="text-[11px] text-slate-400">
                                Dokumen resmi berita acara validasi dan catatan butir soal untuk proktor.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={handlePrint}
                            className="bg-primary hover:bg-primary/90 text-white font-bold flex items-center gap-1.5 text-xs shadow-sm"
                            disabled={loading || !!error}
                        >
                            <Printer size={14} /> Cetak / Simpan PDF
                        </Button>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Printable Content Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 print:p-0 print:overflow-visible bg-slate-100 dark:bg-slate-950 print:bg-white">
                    {loading ? (
                        <div className="py-24 flex flex-col items-center justify-center gap-3">
                            <Loader2 size={36} className="animate-spin text-primary" />
                            <p className="text-xs text-slate-400 font-medium">Menyiapkan laporan validasi...</p>
                        </div>
                    ) : error || !validation ? (
                        <div className="py-20 text-center space-y-3">
                            <AlertCircle size={36} className="text-rose-500 mx-auto" />
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{error || 'Data tidak ditemukan'}</p>
                            <Button onClick={onClose} variant="outline" size="sm">Tutup</Button>
                        </div>
                    ) : (
                        <div
                            id="validation-report-print-sheet"
                            className="max-w-[210mm] mx-auto bg-white text-slate-900 p-8 sm:p-10 shadow-lg print:shadow-none print:p-0 print:max-w-none text-xs leading-relaxed"
                            style={{ fontFamily: "'Times New Roman', Times, serif" }}
                        >
                            {/* Kop Surat Resmi */}
                            <div className="border-b-4 border-double border-slate-900 pb-3 mb-6 text-center">
                                <h1 className="text-base font-bold tracking-wide uppercase font-serif">
                                    MAN INSAN CENDEKIA GOWA
                                </h1>
                                <h2 className="text-sm font-bold tracking-wider uppercase font-serif mt-0.5">
                                    COMPUTER BASED TEST (ACCA CBT)
                                </h2>
                                <p className="text-[11px] text-slate-600 mt-1 italic font-sans">
                                    Jl. Pendidikan, Desa Belapunranga, Kec. Parangloe, Kab. Gowa, Sulawesi Selatan
                                </p>
                            </div>

                            {/* Judul Dokumen */}
                            <div className="text-center mb-6">
                                <h3 className="text-sm font-bold uppercase underline tracking-wider font-serif">
                                    BERITA ACARA & LAPORAN VALIDASI BUTIR SOAL
                                </h3>
                                <p className="text-[11px] text-slate-600 font-sans mt-0.5">
                                    Nomor Dokumen: VAL/{validation.id.slice(0, 8).toUpperCase()}/{new Date().getFullYear()}
                                </p>
                            </div>

                            {/* Identitas Bank Soal */}
                            <div className="mb-6 font-sans text-[11px]">
                                <table className="w-full border-collapse">
                                    <tbody>
                                        <tr>
                                            <td className="w-36 py-1 font-semibold text-slate-700">Judul Bank Soal</td>
                                            <td className="w-4 py-1">:</td>
                                            <td className="py-1 font-bold text-slate-900">{validation.title}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1 font-semibold text-slate-700">Mata Pelajaran</td>
                                            <td className="py-1">:</td>
                                            <td className="py-1">{validation.bank?.subject || '-'}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1 font-semibold text-slate-700">Tingkat / Kelas</td>
                                            <td className="py-1">:</td>
                                            <td className="py-1">{validation.bank?.class_level || 'Semua Kelas'}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1 font-semibold text-slate-700">Guru Penyusun (Author)</td>
                                            <td className="py-1">:</td>
                                            <td className="py-1">
                                                {validation.bank?.creator_name || (validation.bank as any)?.creator?.full_name || 'Guru Mapel'}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="py-1 font-semibold text-slate-700">Tanggal Sesi Validasi</td>
                                            <td className="py-1">:</td>
                                            <td className="py-1">
                                                {validation.created_at ? new Date(validation.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="py-1 font-semibold text-slate-700">Status Kelayakan Bank Soal</td>
                                            <td className="py-1">:</td>
                                            <td className="py-1">
                                                <span className="font-bold uppercase tracking-wider">
                                                    {getStatusLabel(validation.status)}
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* 1. Rekapitulasi Tim Validator */}
                            <div className="mb-6 font-sans">
                                <h4 className="font-bold text-xs uppercase text-slate-800 mb-2 border-b border-slate-300 pb-1">
                                    I. Tim Guru Validator & Rekomendasi Umum
                                </h4>
                                <table className="w-full border-collapse border border-slate-400 text-[10px]">
                                    <thead>
                                        <tr className="bg-slate-100 font-bold text-slate-800 text-center">
                                            <th className="border border-slate-400 px-2 py-1.5 w-8">No</th>
                                            <th className="border border-slate-400 px-2 py-1.5 text-left">Nama Guru Validator</th>
                                            <th className="border border-slate-400 px-2 py-1.5 w-24">Status</th>
                                            <th className="border border-slate-400 px-2 py-1.5 w-32">Rekomendasi</th>
                                            <th className="border border-slate-400 px-2 py-1.5 text-left">Kesimpulan Umum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {validation.validators && validation.validators.length > 0 ? (
                                            validation.validators.map((v, i) => (
                                                <tr key={v.id} className="align-top">
                                                    <td className="border border-slate-400 px-2 py-1 text-center font-medium">{i + 1}</td>
                                                    <td className="border border-slate-400 px-2 py-1 font-bold">{v.profile?.full_name || 'Guru Validator'}</td>
                                                    <td className="border border-slate-400 px-2 py-1 text-center">
                                                        {v.status === 'submitted' ? 'Selesai' : 'Belum'}
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1 text-center font-semibold">
                                                        {getRecommendationLabel(v.general_recommendation)}
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1 italic text-slate-700">
                                                        {v.general_comment || '-'}
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="border border-slate-400 px-2 py-2 text-center text-slate-400">
                                                    Belum ada validator yang ditugaskan.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* 2. Detail Catatan Validasi Per Butir Soal */}
                            <div className="mb-8 font-sans">
                                <h4 className="font-bold text-xs uppercase text-slate-800 mb-2 border-b border-slate-300 pb-1">
                                    II. Rincian Catatan Masukan Butir Soal
                                </h4>
                                {notes.length === 0 ? (
                                    <div className="p-3 border border-slate-300 rounded text-center text-[10px] text-slate-500 italic">
                                        Tidak ada catatan perbaikan khusus per butir soal (semua butir dinyatakan sesuai).
                                    </div>
                                ) : (
                                    <table className="w-full border-collapse border border-slate-400 text-[10px]">
                                        <thead>
                                            <tr className="bg-slate-100 font-bold text-slate-800 text-center">
                                                <th className="border border-slate-400 px-1.5 py-1.5 w-8">No</th>
                                                <th className="border border-slate-400 px-1.5 py-1.5 w-14">Nomor Soal</th>
                                                <th className="border border-slate-400 px-2 py-1.5 w-24 text-left">Bagian</th>
                                                <th className="border border-slate-400 px-2 py-1.5 w-32 text-left">Kategori Masukan</th>
                                                <th className="border border-slate-400 px-2 py-1.5 text-left">Teks Ditandai & Catatan Validator</th>
                                                <th className="border border-slate-400 px-2 py-1.5 w-28 text-left">Validator</th>
                                                <th className="border border-slate-400 px-1.5 py-1.5 w-20 text-center">Tindak Lanjut</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {notes.map((note, index) => (
                                                <tr key={note.id} className="align-top">
                                                    <td className="border border-slate-400 px-1.5 py-1 text-center font-medium">{index + 1}</td>
                                                    <td className="border border-slate-400 px-1.5 py-1 text-center font-bold">
                                                        Soal #{getQuestionNumber(note.question_id)}
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1">
                                                        {getScopeLabel(note.target_scope)}
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1 font-medium">
                                                        {getCategoryLabel(note.category)}
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1 space-y-1">
                                                        {note.selected_text && (
                                                            <div className="bg-slate-50 p-1 rounded border border-slate-200 text-slate-600 italic">
                                                                "{note.selected_text}"
                                                            </div>
                                                        )}
                                                        <div className="font-medium text-slate-900">
                                                            {note.comment}
                                                        </div>
                                                    </td>
                                                    <td className="border border-slate-400 px-2 py-1">
                                                        {note.validator?.full_name || 'Validator'}
                                                    </td>
                                                    <td className="border border-slate-400 px-1.5 py-1 text-center font-semibold">
                                                        {note.is_resolved ? (
                                                            <span className="text-emerald-700">Sudah Selesai</span>
                                                        ) : (
                                                            <span className="text-amber-700">Pending</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* 3. Lembar Pengesahan Tanda Tangan Proktor (Nama dan NIP Dikosongkan) */}
                            <div className="mt-8 pt-4 font-sans text-[11px] break-inside-avoid">
                                <div className="flex justify-between items-start">
                                    <div className="w-1/2">
                                        <p className="text-slate-600 mb-1">Catatan Tambahan Proktor:</p>
                                        <div className="border border-dashed border-slate-400 h-16 rounded p-1 text-[9px] text-slate-400">
                                            (Ruang catatan manual proktor pelaksanaan ujian)
                                        </div>
                                    </div>
                                    <div className="w-64 text-center">
                                        <p className="mb-0.5">Gowa, {todayDateFormatted}</p>
                                        <p className="font-semibold mb-16">Mengetahui,<br />Proktor CBT / Pelaksana Ujian,</p>
                                        {/* Nama dan NIP Dikosongkan sesuai permintaan user */}
                                        <p className="font-bold tracking-wider">( ............................................................ )</p>
                                        <p className="text-slate-600 mt-1">NIP. .........................................................</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CSS Print Styles */}
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 12mm 15mm 15mm 15mm;
                    }
                    body {
                        background: #ffffff !important;
                        color: #000000 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    /* Sembunyikan elemen dashboard, navigasi, dan dialog saat cetak */
                    header, aside, nav, .sidebar, .sidebar-nav, .dashboard-header,
                    .print\\:hidden, button, .modal-backdrop {
                        display: none !important;
                    }
                    #validation-report-print-sheet {
                        width: 100% !important;
                        max-width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        box-shadow: none !important;
                        border: none !important;
                    }
                }
            `}</style>
        </div>
    );
}
