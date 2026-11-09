"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { getBankValidationFeedback, resolveValidationNote, type ValidationSession } from '@/lib/api/validations';
import { InlineSelect } from '@/app/components/ui/inlineselect';

export function ValidationNotesPanel({ bankId, questionId }: { bankId: string; questionId: string }) {
    const [sessions, setSessions] = useState<ValidationSession[]>([]);
    const [selected, setSelected] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('validation') || '' : '');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setSessions(await getBankValidationFeedback(bankId)); }
        catch (err) { setError(err instanceof Error ? err.message : 'Catatan gagal dimuat.'); }
        finally { setLoading(false); }
    }, [bankId]);
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) void load(); });
        return () => { active = false; };
    }, [load]);
    const session = sessions.find(item => item.id === selected) || sessions[0];
    const notes = (session?.notes || []).filter(note => note.question_id === questionId);
    return <aside aria-label="Catatan validasi soal" className="w-full xl:w-80 shrink-0 border-l border-blue-100 bg-blue-50/50 p-4 xl:overflow-y-auto text-sm space-y-3">
        <h2 className="font-bold text-blue-800">Catatan Validasi</h2>
        <p className="text-xs text-slate-500">Simpan perubahan soal sebelum menandai catatan sudah diperbaiki. Tanda ini bukan persetujuan ulang validator.</p>
        {loading && <p role="status">Memuat catatan…</p>}
        {error && <div role="alert" className="text-red-700">{error}<button type="button" onClick={() => void load()} className="block underline">Coba lagi</button></div>}
        {!!sessions.length && <div>
            <label htmlFor="validation-notes-session" className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Sesi validasi</label>
            <InlineSelect
                id="validation-notes-session"
                value={session.id}
                onChange={setSelected}
                minWidth="100%"
                height="42px"
                options={sessions.map(item => ({ value: item.id, label: `${item.title} — ${new Date(item.created_at).toLocaleDateString('id-ID')}` }))}
            />
        </div>}
        {!loading && !error && !notes.length && <p>Belum ada catatan untuk soal ini pada sesi yang dipilih.</p>}
        {notes.map(note => <article key={note.id} className="space-y-2 rounded-lg border border-blue-100 bg-white p-3">
            <p className="text-xs font-semibold text-blue-700">{note.category} · {note.target_scope === 'option' ? 'Pilihan jawaban' : note.target_scope === 'stimulus' ? 'Stimulus' : note.target_scope === 'question_text' ? 'Teks soal' : 'Umum'}</p>
            {note.selected_text && <blockquote className="border-l-2 border-amber-300 pl-2 text-xs text-slate-600 whitespace-pre-wrap">{note.selected_text}</blockquote>}
            <p className="whitespace-pre-wrap break-words">{note.comment}</p>
            <p className="text-xs text-slate-500">{note.validator?.full_name || 'Validator'}</p>
            {note.verification === 'accepted' && <p className="text-xs font-semibold text-emerald-700">✓ Perbaikan diterima validator</p>}
            {note.verification === 'not_fixed' && !note.is_resolved && <p className="text-xs font-semibold text-rose-600">Validator menilai perbaikan belum sesuai.</p>}
            {session?.status === 'resubmitted' && <p className="text-xs text-violet-700">Sedang ditelaah ulang validator; tanda perbaikan dikunci.</p>}
            <button type="button" disabled={!!busy || session?.status === 'resubmitted' || note.verification === 'accepted'} className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-xs font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 ${note.is_resolved ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'}`} onClick={async () => {
                setBusy(note.id); setError('');
                try {
                    const result = await resolveValidationNote(note.id, !note.is_resolved);
                    if (!result.success) throw new Error(result.error || 'Status perbaikan gagal disimpan.');
                    setSessions(previous => previous.map(item => ({ ...item, notes: item.notes?.map(value => value.id === note.id ? { ...value, is_resolved: !note.is_resolved } : value) })));
                    window.dispatchEvent(new Event('validation-feedback-updated'));
                } catch (err) { setError(err instanceof Error ? err.message : 'Status perbaikan gagal disimpan.'); }
                finally { setBusy(''); }
            }}>{note.is_resolved && note.verification !== 'accepted' ? <RotateCcw size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{busy === note.id ? 'Menyimpan…' : note.verification === 'accepted' ? 'Sudah diperbaiki' : note.is_resolved ? 'Batalkan tanda diperbaiki' : 'Tandai sudah diperbaiki'}</button>
        </article>)}
    </aside>;
}
