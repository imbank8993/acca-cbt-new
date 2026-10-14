"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { getBankValidationFeedback, type ValidationSession } from '@/lib/api/validations';
import type { QuestionRecord } from '@/lib/api/questions';

export default function BankValidationSummary({ bankId, questions, onOpenFeedback, onEditQuestion }: {
    bankId: string;
    questions: QuestionRecord[];
    onOpenFeedback: (sessionId: string) => void;
    onEditQuestion: (question: QuestionRecord) => void;
}) {
    const [sessions, setSessions] = useState<ValidationSession[]>([]);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try { setSessions(await getBankValidationFeedback(bankId)); setError(''); }
        catch (err) { setError(err instanceof Error ? err.message : 'Catatan validasi gagal dimuat.'); }
    }, [bankId]);
    useEffect(() => {
        void load();
        const refresh = () => { if (!document.hidden) void load(); };
        window.addEventListener('focus', refresh);
        window.addEventListener('validation-feedback-updated', refresh);
        return () => {
            window.removeEventListener('focus', refresh);
            window.removeEventListener('validation-feedback-updated', refresh);
        };
    }, [load]);

    if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error} <button type="button" onClick={() => void load()} className="underline">Coba lagi</button>
    </div>;
    if (!sessions.length) return null;
    return <section aria-label="Hasil validasi bank soal" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
        <h2 className="font-bold">Hasil Validasi Bank Soal</h2>
        {sessions.map(session => {
            const notes = (session.notes || []).filter(note => !note.is_resolved && note.status_item !== 'valid');
            const questionIds = new Set(notes.map(note => note.question_id));
            return <div key={session.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p><span className="font-semibold">{session.title}</span> · {notes.length} catatan perlu perbaikan pada {questionIds.size} soal</p>
                    <button type="button" onClick={() => onOpenFeedback(session.id)} className="font-semibold text-blue-700 underline">Lihat catatan & hasil validasi</button>
                </div>
                {notes.map(note => {
                    const index = questions.findIndex(question => question.id === note.question_id);
                    const question = questions[index];
                    const scope = note.target_scope === 'option' ? 'Pilihan jawaban' : note.target_scope === 'stimulus' ? 'Stimulus' : note.target_scope === 'question_text' ? 'Teks soal' : 'Umum';
                    return <article key={note.id} className="rounded-lg border border-amber-100 bg-white p-3 space-y-1">
                        <p className="text-xs font-semibold">{index >= 0 ? `Soal ${index + 1}` : 'Soal tidak tersedia'} · {scope} · {note.validator?.full_name || 'Validator'}</p>
                        {note.selected_text && <blockquote className="border-l-2 border-amber-300 pl-2 whitespace-pre-wrap break-words">{note.selected_text}</blockquote>}
                        <p className="whitespace-pre-wrap break-words">{note.comment}</p>
                        {question && <button type="button" onClick={() => onEditQuestion(question)} className="text-xs font-semibold text-blue-700 underline">Buka soal untuk diperbaiki</button>}
                    </article>;
                })}
            </div>;
        })}
    </section>;
}
