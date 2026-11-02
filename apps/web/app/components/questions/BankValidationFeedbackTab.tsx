"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
    ShieldCheck,
    User,
    Edit3,
    CheckSquare,
    Square,
    Printer,
    Send,
    MessageSquareReply,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import {
    getBankValidationFeedback,
    resolveValidationNote,
    resubmitValidation,
    type ValidationSession,
    type ValidationNote,
} from '@/lib/api/validations';
import type { QuestionRecord } from '@/lib/api/questions';
import { ValidationReportModal } from '@/app/components/validations/ValidationReportModal';
import { VALIDATION_STATUS_LABELS } from '@/lib/validation-status';

const recommendationLabels = { approved: 'Disetujui', revision_needed: 'Perlu revisi', rejected: 'Ditolak' } as const;
const categoryLabels = { typo: 'Salah ketik', materi: 'Materi', kunci_jawaban: 'Kunci jawaban', konstruksi: 'Konstruksi', bahasa: 'Bahasa', lainnya: 'Lainnya' };
const itemLabels = { valid: 'Layak', revision: 'Revisi', rejected: 'Tolak' } as const;

interface BankValidationFeedbackTabProps {
    bankId: string;
    questions: QuestionRecord[];
    onEditQuestion: (question: QuestionRecord) => void;
}

/** Tanda perbaikan per catatan, berdasarkan versi soal dan penilaian validator. */
function fixBadge(note: ValidationNote, question: QuestionRecord | null): { text: string; tone: string } | null {
    if (note.verification === 'accepted') return { text: '✓ Perbaikan diterima validator', tone: 'text-emerald-700 dark:text-emerald-300' };
    if (!note.is_resolved) {
        return note.verification === 'not_fixed'
            ? { text: 'Validator menilai perbaikan belum sesuai — perbaiki lagi', tone: 'text-rose-600 dark:text-rose-300' }
            : null;
    }
    if (typeof question?.revision === 'number' && typeof note.question_revision === 'number') {
        return question.revision > note.question_revision
            ? { text: 'Soal sudah diubah sejak catatan dibuat', tone: 'text-emerald-700 dark:text-emerald-300' }
            : { text: 'Ditandai diperbaiki tanpa perubahan soal — beri tanggapan bila memang tidak perlu diubah', tone: 'text-amber-700 dark:text-amber-300' };
    }
    return { text: 'Ditandai diperbaiki', tone: 'text-emerald-700 dark:text-emerald-300' };
}

export default function BankValidationFeedbackTab({
    bankId,
    questions,
    onEditQuestion,
}: BankValidationFeedbackTabProps) {
    const [validations, setValidations] = useState<ValidationSession[]>([]);
    const [selectedSession, setSelectedSession] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('validation') || '' : '');
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [loading, setLoading] = useState(true);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
    const [openResponseId, setOpenResponseId] = useState<string | null>(null);
    const [isResubmitting, setIsResubmitting] = useState(false);
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

    const updateNote = (noteId: string, patch: Partial<ValidationNote>) => {
        setValidations(prev => prev.map(v => ({
            ...v,
            notes: v.notes?.map(n => n.id === noteId ? { ...n, ...patch } : n),
        })));
    };

    const handleToggleResolve = async (note: ValidationNote, nextState = !note.is_resolved) => {
        setResolvingId(note.id);
        setActionError('');
        try {
            const draft = responseDrafts[note.id];
            const response = draft !== undefined ? draft.trim() : undefined;
            const res = await resolveValidationNote(note.id, nextState, response);
            if (!res.success) throw new Error(res.error || 'Status perbaikan gagal disimpan.');
            updateNote(note.id, {
                is_resolved: nextState,
                verification: null,
                ...(response !== undefined ? { owner_response: response } : {}),
            });
            setOpenResponseId(null);
            window.dispatchEvent(new Event('validation-feedback-updated'));
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Status perbaikan gagal disimpan.');
        } finally {
            setResolvingId(null);
        }
    };

    const handleResubmit = async (sessionId: string) => {
        setIsResubmitting(true);
        setActionError('');
        try {
            const res = await resubmitValidation(sessionId);
            if (!res.success) throw new Error(res.error || 'Telaah ulang belum dapat diajukan.');
            await loadData();
            window.dispatchEvent(new Event('validation-feedback-updated'));
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Telaah ulang belum dapat diajukan.');
        } finally {
            setIsResubmitting(false);
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
    const round = latestValidation.round ?? 1;
    const underReview = latestValidation.status === 'resubmitted';
    const canResubmit = latestValidation.status === 'revision_needed' || latestValidation.status === 'rejected';

    const actionable = notes.filter(n => n.status_item !== 'valid');
    const openCount = actionable.filter(n => !n.is_resolved).length;
    const awaitingCount = actionable.filter(n => n.is_resolved && n.verification !== 'accepted').length;
    const acceptedCount = actionable.filter(n => n.verification === 'accepted').length;

    const sortedNotes = [...notes].sort((a, b) => {
        const qa = questions.findIndex(q => q.id === a.question_id);
        const qb = questions.findIndex(q => q.id === b.question_id);
        return (qa < 0 ? Infinity : qa) - (qb < 0 ? Infinity : qb);
    });

    return (
        <div className="space-y-6">
            <label className="block text-sm font-semibold">Riwayat sesi validasi
                <select className="block mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" value={latestValidation.id} onChange={event => { setSelectedSession(event.target.value); const url = new URL(window.location.href); url.searchParams.set('validation', event.target.value); url.searchParams.set('tab', 'validations'); window.history.replaceState({}, '', url); }}>
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
                                    : latestValidation.status === 'rejected'
                                    ? 'bg-rose-100 text-rose-600'
                                    : latestValidation.status === 'resubmitted'
                                    ? 'bg-violet-100 text-violet-600'
                                    : 'bg-blue-100 text-blue-600'
                            }`}
                        >
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                    Status Validasi:
                                </h3>
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {VALIDATION_STATUS_LABELS[latestValidation.status] || latestValidation.status}
                                </span>
                                {round > 1 && (
                                    <span className="px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-[10px] font-semibold">
                                        Putaran {round}
                                    </span>
                                )}
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
                        <p className="text-slate-500 dark:text-slate-400">
                            {openCount} perlu perbaikan · {awaitingCount} menunggu telaah · {acceptedCount} diterima
                        </p>
                    </div>
                </div>

                {/* Telaah ulang */}
                {canResubmit && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 p-3 text-xs">
                        <p className="text-violet-800 dark:text-violet-200">
                            {openCount > 0
                                ? `Perbaiki soal lalu tandai setiap catatan. Masih ${openCount} catatan yang belum ditandai diperbaiki.`
                                : 'Semua catatan sudah ditandai diperbaiki. Ajukan telaah ulang agar validator memeriksa perbaikan Anda.'}
                        </p>
                        <Button
                            size="sm"
                            disabled={openCount > 0 || isResubmitting}
                            onClick={() => handleResubmit(latestValidation.id)}
                            className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0"
                        >
                            <Send size={13} /> {isResubmitting ? 'Mengajukan…' : 'Ajukan Telaah Ulang'}
                        </Button>
                    </div>
                )}
                {underReview && (
                    <p role="status" className="rounded-xl border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 p-3 text-xs text-violet-800 dark:text-violet-200">
                        Perbaikan sedang ditelaah ulang validator (putaran {round}). Tanda perbaikan dikunci sampai hasil telaah keluar.
                    </p>
                )}
                {actionError && <p role="alert" className="text-xs text-red-600">{actionError}</p>}

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
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {v.status === 'submitted' && v.general_recommendation
                                        ? recommendationLabels[v.general_recommendation]
                                        : round > 1 ? 'Sedang menelaah ulang' : 'Belum selesai'}
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
                        {sortedNotes.map(note => {
                            const questionIdx = questions.findIndex(q => q.id === note.question_id);
                            const qNumber = questionIdx >= 0 ? questionIdx + 1 : '?';
                            const targetQuestion = questionIdx >= 0 ? questions[questionIdx] : null;
                            const needsFix = note.status_item !== 'valid';
                            const badge = needsFix ? fixBadge(note, targetQuestion) : null;
                            const locked = underReview || note.verification === 'accepted';
                            const draft = responseDrafts[note.id] ?? note.owner_response ?? '';

                            return (
                                <div
                                    key={note.id}
                                    className={`p-4 rounded-2xl border transition-all ${
                                        !needsFix || note.is_resolved
                                            ? 'bg-slate-50/80 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'
                                            : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/50 shadow-sm'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                                                Soal Nomor {qNumber}
                                            </span>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                {categoryLabels[note.category]}
                                            </span>
                                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                                {itemLabels[note.status_item] || note.status_item}
                                            </span>
                                            {round > 1 && <span className="text-[10px] text-slate-400">Putaran {note.round ?? 1}</span>}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            {needsFix && (
                                                <Button
                                                    variant="outline"
                                                    onClick={() => handleToggleResolve(note)}
                                                    disabled={resolvingId === note.id || locked}
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
                                            )}
                                            {needsFix && !locked && (
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setOpenResponseId(current => current === note.id ? null : note.id)}
                                                    className="text-xs py-1 px-2.5 h-7 font-bold flex items-center gap-1"
                                                >
                                                    <MessageSquareReply size={12} /> Tanggapan
                                                </Button>
                                            )}
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
                                    <p className="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed whitespace-pre-wrap break-words">
                                        {note.comment}
                                    </p>

                                    {badge && <p className={`mt-2 text-[11px] font-semibold ${badge.tone}`}>{badge.text}</p>}
                                    {note.owner_response && openResponseId !== note.id && (
                                        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                                            <span className="font-semibold">Tanggapan Anda:</span> {note.owner_response}
                                        </p>
                                    )}

                                    {openResponseId === note.id && (
                                        <div className="mt-2 space-y-2">
                                            <textarea
                                                rows={2}
                                                value={draft}
                                                aria-label="Tanggapan untuk validator"
                                                onChange={e => setResponseDrafts(prev => ({ ...prev, [note.id]: e.target.value }))}
                                                placeholder="Contoh: Sudah diganti menjadi 'massa jenis'. / Tidak diubah karena istilah ini sesuai buku teks."
                                                className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                                            />
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" onClick={() => setOpenResponseId(null)} className="text-xs h-7">Batal</Button>
                                                <Button size="sm" disabled={resolvingId === note.id}
                                                    onClick={() => handleToggleResolve(note, true)}
                                                    className="bg-primary text-white text-xs h-7 font-bold">
                                                    Simpan & Tandai Diperbaiki
                                                </Button>
                                            </div>
                                        </div>
                                    )}

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
