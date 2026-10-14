"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { getBankValidationFeedback, resolveValidationNote, type ValidationSession } from '@/lib/api/validations';

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
        {!!sessions.length && <label className="block">Sesi validasi<select className="mt-1 w-full rounded border bg-white p-2" value={session.id} onChange={event => setSelected(event.target.value)}>{sessions.map(item => <option key={item.id} value={item.id}>{item.title} — {new Date(item.created_at).toLocaleDateString('id-ID')}</option>)}</select></label>}
        {!loading && !error && !notes.length && <p>Belum ada catatan untuk soal ini pada sesi yang dipilih.</p>}
        {notes.map(note => <article key={note.id} className="space-y-2 rounded-lg border border-blue-100 bg-white p-3">
            <p className="text-xs font-semibold text-blue-700">{note.category} · {note.target_scope === 'option' ? 'Pilihan jawaban' : note.target_scope === 'stimulus' ? 'Stimulus' : note.target_scope === 'question_text' ? 'Teks soal' : 'Umum'}</p>
            {note.selected_text && <blockquote className="border-l-2 border-amber-300 pl-2 text-xs text-slate-600 whitespace-pre-wrap">{note.selected_text}</blockquote>}
            <p className="whitespace-pre-wrap break-words">{note.comment}</p>
            <p className="text-xs text-slate-500">{note.validator?.full_name || 'Validator'}</p>
            <button type="button" disabled={!!busy} className="text-xs font-semibold text-blue-700 disabled:opacity-50" onClick={async () => {
                setBusy(note.id); setError('');
                try {
                    const result = await resolveValidationNote(note.id, !note.is_resolved);
                    if (!result.success) throw new Error(result.error || 'Status perbaikan gagal disimpan.');
                    setSessions(previous => previous.map(item => ({ ...item, notes: item.notes?.map(value => value.id === note.id ? { ...value, is_resolved: !note.is_resolved } : value) })));
                    window.dispatchEvent(new Event('validation-feedback-updated'));
                } catch (err) { setError(err instanceof Error ? err.message : 'Status perbaikan gagal disimpan.'); }
                finally { setBusy(''); }
            }}>{busy === note.id ? 'Menyimpan…' : note.is_resolved ? 'Sudah diperbaiki · Batalkan tanda' : 'Tandai sudah diperbaiki'}</button>
        </article>)}
    </aside>;
}
