"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
    ShieldCheck,
    User,
    Edit3,
    CheckSquare,
    Square,
    Printer,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import {
    getBankValidationFeedback,
    resolveValidationNote,
    type ValidationSession,
    type ValidationNote,
} from '@/lib/api/validations';
import type { QuestionRecord } from '@/lib/api/questions';
import { ValidationReportModal } from '@/app/components/validations/ValidationReportModal';

const statusLabels = { pending: 'Menunggu validasi', in_progress: 'Sedang divalidasi', revision_needed: 'Perlu perbaikan', approved: 'Disetujui', rejected: 'Ditolak' };
const categoryLabels = { typo: 'Salah ketik', materi: 'Materi', kunci_jawaban: 'Kunci jawaban', konstruksi: 'Konstruksi', bahasa: 'Bahasa', lainnya: 'Lainnya' };

interface BankValidationFeedbackTabProps {
    bankId: string;
    questions: QuestionRecord[];
    onEditQuestion: (question: QuestionRecord) => void;
}

export default function BankValidationFeedbackTab({
    bankId,
    questions,
    onEditQuestion,
}: BankValidationFeedbackTabProps) {
    const [validations, setValidations] = useState<ValidationSession[]>([]);
    const [selectedSession, setSelectedSession] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('validation') || '' : '');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [isReportOpen, setIsReportOpen] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const res = await getBankValidationFeedback(bankId);
            setValidations(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Catatan validasi gagal dimuat.');
        } finally {
            setLoading(false);
        }
    }, [bankId]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
        const refresh = () => { void loadData(); };
        window.addEventListener('validation-feedback-updated', refresh);
        return () => { window.clearTimeout(initialLoad); window.removeEventListener('validation-feedback-updated', refresh); };
    }, [loadData]);

    const handleToggleResolve = async (note: ValidationNote) => {
        setResolvingId(note.id);
        try {
            const nextState = !note.is_resolved;
            const res = await resolveValidationNote(note.id, nextState);
            if (!res.success) throw new Error(res.error || 'Status perbaikan gagal disimpan.');
            if (res.success) {
                // Update local state
                setValidations(prev =>
                    prev.map(v => ({
                        ...v,
                        notes: v.notes?.map(n =>
                            n.id === note.id ? { ...n, is_resolved: nextState } : n
                        ),
                    }))
                );
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Status perbaikan gagal disimpan.');
        } finally {
            setResolvingId(null);
        }
    };

    if (loading) {
        return (
            <div className="py-16 flex flex-col items-center justify-center gap-2">
                <Spinner size={28} />
                <p className="text-xs text-slate-400">Memeriksa catatan validator...</p>
            </div>
        );
    }

    if (error) return <div role="alert" className="p-5 rounded-xl border border-red-200 bg-red-50 text-sm">{error}<Button onClick={() => void loadData()}>Coba lagi</Button></div>;

    if (validations.length === 0) {
        return (
            <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center p-6 space-y-3">
                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                    <ShieldCheck size={24} />
                </div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Belum Ada Riwayat Validasi
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Bank soal ini belum pernah ditugaskan untuk validasi oleh Admin atau Proktor.
                </p>
            </div>
        );
    }

    const latestValidation = validations.find(session => session.id === selectedSession) || validations[0];
    const notes = latestValidation?.notes || [];
    const validators = latestValidation?.validators || [];

    const unresolvedCount = notes.filter(n => !n.is_resolved).length;
    const resolvedCount = notes.filter(n => n.is_resolved).length;

    return (
        <div className="space-y-6">
            <label className="block text-sm font-semibold">Riwayat sesi validasi
                <select className="block mt-2 w-full rounded-lg border p-2 bg-white text-slate-800" value={latestValidation.id} onChange={event => { setSelectedSession(event.target.value); const url = new URL(window.location.href); url.searchParams.set('validation', event.target.value); url.searchParams.set('tab', 'validations'); window.history.replaceState({}, '', url); }}>
                    {validations.map(session => <option key={session.id} value={session.id}>{session.title} — {new Date(session.created_at).toLocaleDateString('id-ID')}</option>)}
                </select>
            </label>
            {/* Header Status Validasi */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                latestValidation.status === 'approved'
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : latestValidation.status === 'revision_needed'
                                    ? 'bg-amber-100 text-amber-600'
                                    : 'bg-blue-100 text-blue-600'
                            }`}
                        >
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                    Status Validasi:
                                </h3>
                                <span
                                    className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                                >
                                    {statusLabels[latestValidation.status]}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {latestValidation.title} • Ditugaskan pada{' '}
                                {new Date(latestValidation.created_at).toLocaleDateString('id-ID')}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsReportOpen(true)}
                            className="flex items-center gap-1.5 text-xs font-bold"
                        >
                            <Printer size={13} /> Cetak Laporan
                        </Button>
                        <p className="text-slate-500 dark:text-slate-400">{unresolvedCount} perlu perbaikan · {resolvedCount} sudah diperbaiki</p>
                    </div>
                </div>

                {/* Tim Validator & Kesimpulan Umum */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    {validators.map(v => (
                        <div
                            key={v.id}
                            className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs space-y-1.5"
                        >
                            <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                                <span className="flex items-center gap-1.5">
                                    <User size={13} className="text-primary" /> {v.profile?.full_name || 'Validator'}
                                </span>
                                <span
                                    className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                                >
                                    {v.general_recommendation ? statusLabels[v.general_recommendation] : 'Belum selesai'}
                                </span>
                            </div>
                            {v.general_comment && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                    &quot;{v.general_comment}&quot;
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Daftar Catatan Per Nomor Soal */}
            <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Daftar Catatan Per Butir Soal ({notes.length})
                </h3>

                {notes.length === 0 ? (
                    <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                        Tidak ada catatan butir soal khusus dari validator.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {notes.map(note => {
                            const questionIdx = questions.findIndex(q => q.id === note.question_id);
                            const qNumber = questionIdx >= 0 ? questionIdx + 1 : '?';
                            const targetQuestion = questionIdx >= 0 ? questions[questionIdx] : null;

                            return (
                                <div
                                    key={note.id}
                                    className={`p-4 rounded-2xl border transition-all ${
                                        note.is_resolved
                                            ? 'bg-slate-50/80 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-80'
                                            : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/50 shadow-sm'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                                                Soal Nomor {qNumber}
                                            </span>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                {categoryLabels[note.category]}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                onClick={() => handleToggleResolve(note)}
                                                disabled={resolvingId === note.id}
                                                className={`text-xs py-1 px-2.5 h-7 font-bold flex items-center gap-1.5 ${
                                                    note.is_resolved
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                                        : 'hover:bg-slate-100 text-slate-600'
                                                }`}
                                            >
                                                {note.is_resolved ? (
                                                    <>
                                                        <CheckSquare size={13} className="text-emerald-600" /> Sudah Diperbaiki
                                                    </>
                                                ) : (
                                                    <>
                                                        <Square size={13} /> Tandai Selesai
                                                    </>
                                                )}
                                            </Button>

                                            {targetQuestion && (
                                                <Button
                                                    onClick={() => onEditQuestion(targetQuestion)}
                                                    className="bg-primary hover:bg-primary/90 text-white text-xs py-1 px-2.5 h-7 font-bold flex items-center gap-1"
                                                >
                                                    <Edit3 size={12} /> Edit Soal Ini
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Teks Kutipan Highlight */}
                                    {note.selected_text && (
                                        <div className="mb-2 p-2 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 text-xs font-mono text-amber-900 dark:text-amber-200 italic">
                                            &quot;{note.selected_text}&quot;
                                        </div>
                                    )}

                                    {/* Isi Komentar Validator */}
                                    <p className="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                                        {note.comment}
                                    </p>

                                    <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                                        <span>Validator: {note.validator?.full_name || 'Guru Validator'}</span>
                                        <span>{new Date(note.created_at).toLocaleDateString('id-ID')}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal Laporan Validasi */}
            {latestValidation && (
                <ValidationReportModal
                    isOpen={isReportOpen}
                    onClose={() => setIsReportOpen(false)}
                    validationId={latestValidation.id}
                />
            )}
        </div>
    );
}
