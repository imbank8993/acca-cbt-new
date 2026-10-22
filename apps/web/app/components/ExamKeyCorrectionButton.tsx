'use client';
import { useState } from 'react';
import { CORRECTABLE_QUESTION_TYPES, applyExamQuestionKey, examQuestionKey, type KeyQuestion } from '@acca-cbt/shared';
import type { Question } from '@/app/types';
import { apiGet, apiSend } from '@/lib/api/client';
import { Modal, ModalBody, ModalFooter } from './ui/modal';
import { Button } from './ui/button';
import { QuestionRenderer } from './questions/QuestionRenderer';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { SearchableSelect } from './ui/SearchableSelect';
import { stripHtml } from '@/lib/answer-display';
import './exam-key-correction.css';

interface CorrectionData {
    questions: Array<Question & KeyQuestion>;
    revision: number;
    correction: { state: string; completed: number; total: number; error?: string } | null;
    /** Soal yang dibatalkan: tidak dihitung dalam skor diperoleh maupun skor maksimum. */
    voided?: Record<string, { at: string; reason: string }>;
    history: Array<{ revision: number; at: string; reason: string; actorId: string; changes: unknown[]; voids?: Array<{ questionId: string; excluded: boolean }> }>;
}
/** Tipe psikometri memang tidak dinilai, jadi tidak perlu (dan tidak bisa) dibatalkan. */
const PERSONALITY_TYPES = ['likert', 'sjt', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'];
const isGraded = (question: { type: string }) => !PERSONALITY_TYPES.includes(question.type);
export function ExamKeyCorrectionButton({ examId, onComplete }: { examId: string; onComplete: () => void }) {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<CorrectionData | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [voidDrafts, setVoidDrafts] = useState<Record<string, boolean>>({});
    const [selectedId, setSelectedId] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const { timeZone } = useSchoolTimeZone();
    const path = `/api/grading/keys/${encodeURIComponent(examId)}`;
    const load = async (preserveDrafts = false) => {
        const response = await apiGet<CorrectionData>(path);
        if (!response.success) { setError(response.error); return null; }
        setData(response);
        if (!preserveDrafts || response.revision !== data?.revision || (response.correction && response.correction.state !== 'ready')) {
            setDrafts(Object.fromEntries(response.questions.filter(q => CORRECTABLE_QUESTION_TYPES.includes(q.type)).map(q => [q.id, examQuestionKey(q)])));
            setVoidDrafts(Object.fromEntries(Object.keys(response.voided || {}).map(id => [id, true])));
            setSelectedId(response.questions.find(isGraded)?.id || '');
        }
        return response;
    };
    const show = async () => {
        setOpen(true); setData(null); setError(''); setReason(''); setProgress(''); setBusy(true);
        try { await load(); } finally { setBusy(false); }
    };
    const recalculate = async () => {
        for (;;) {
            const response = await apiSend<{ done: boolean; completed: number; total: number }>(`${path}/recalculate`, undefined, 'POST', { timeoutMs: 180000 });
            if (!response.success) throw Error(response.error);
            setProgress(response.completed === response.total && !response.done
                ? 'Menghitung ulang model IRT…' : `${response.completed}/${response.total} peserta dinilai ulang`);
            if (response.done) break;
        }
        setProgress('Penilaian ulang selesai. Buka kembali nilai melalui pengaturan ujian setelah diperiksa.');
        await load(); onComplete();
    };
    const save = async () => {
        if (!data) return;
        setBusy(true); setError('');
        try {
            if (!data.correction || data.correction.state === 'ready') {
                // Kunci soal yang dibatalkan tidak dikirim: nilainya tidak dihitung lagi.
                const changes = data.questions.filter(q => CORRECTABLE_QUESTION_TYPES.includes(q.type) && !voidDrafts[q.id] && drafts[q.id] !== examQuestionKey(q)).map(q => ({ questionId: q.id,
                    key: examQuestionKey(applyExamQuestionKey(q, drafts[q.id])) })).filter(change =>
                    change.key !== examQuestionKey(data.questions.find(q => q.id === change.questionId)!));
                const voids = data.questions.filter(q => isGraded(q) && Boolean(voidDrafts[q.id]) !== Boolean(data.voided?.[q.id]))
                    .map(q => ({ questionId: q.id, excluded: Boolean(voidDrafts[q.id]) }));
                if (!changes.length && !voids.length) throw Error('Belum ada perubahan kunci atau soal yang dibatalkan.');
                const response = await apiSend(path, { revision: data.revision, reason, changes, voids });
                if (!response.success) throw Error(response.error);
            }
            await recalculate();
        } catch (error) { setError((error as Error).message); await load(true); }
        finally { setBusy(false); }
    };
    const pending = data?.correction && data.correction.state !== 'ready';
    const selected = data?.questions.find(q => q.id === selectedId);
    return <>
        <Button variant="outline" onClick={() => void show()}>Koreksi Kunci / Batalkan Soal</Button>
        {open && <Modal title="Koreksi Kunci & Pembatalan Soal" size="xl" onClose={() => { if (!busy) setOpen(false); }} closeOnOverlayClick={!busy}>
            <ModalBody className="exam-key-correction__body">
                <p className="text-sm text-slate-500">Koreksi kunci dan pembatalan soal berlaku untuk ujian ini. Nilai akan ditutup sementara, kemudian seluruh peserta dinilai ulang termasuk IRT.</p>
                {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
                {progress && <p role="status" className="mb-4 text-sm text-[#3083FF]">{progress}</p>}
                {!data && <p className="text-sm text-slate-500">{busy ? 'Memuat kunci ujian…' : 'Kunci ujian belum tersedia.'}</p>}
                {data && <>
                    {pending ? <p className="mb-4 text-sm text-slate-600">Penilaian ulang belum selesai: {data.correction?.completed}/{data.correction?.total} peserta. Klik lanjutkan untuk meneruskan proses.</p> : <>
                        <div className="exam-key-correction__picker">
                            <SearchableSelect
                                label="Pilih soal"
                                value={selectedId}
                                onChange={value => setSelectedId(String(value))}
                                disabled={busy}
                                keepHighlightedVisible
                                placeholder="Pilih soal yang akan dikoreksi atau dibatalkan"
                                searchPlaceholder="Ketik nomor atau teks soal…"
                                options={data.questions.flatMap((question, index) => isGraded(question)
                                    ? [{ value: question.id, label: `Soal ${index + 1}${voidDrafts[question.id] ? ' · Dibatalkan' : ''}`, subLabel: stripHtml(question.question_text || '') }]
                                    : [])}
                            />
                        </div>
                        {selected && <fieldset disabled={busy} className={`exam-key-correction__question ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                            <label className={`mb-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${voidDrafts[selected.id] ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={Boolean(voidDrafts[selected.id])}
                                    onChange={event => setVoidDrafts(current => ({ ...current, [selected.id]: event.target.checked }))} />
                                <span>
                                    <span className="font-semibold text-slate-800">Batalkan soal ini (soal cacat, tidak dinilai)</span>
                                    <span className="mt-0.5 block text-xs text-slate-500">Soal dikeluarkan dari nilai seluruh peserta: tidak menambah skor dan tidak menambah skor maksimum, apa pun jawabannya. Bisa dipulihkan kembali.</span>
                                </span>
                            </label>
                            {voidDrafts[selected.id]
                                ? <p className="text-sm text-amber-800">Soal ini tidak akan dihitung. Kunci jawabannya tidak perlu diubah.</p>
                                : CORRECTABLE_QUESTION_TYPES.includes(selected.type) ? <>
                                    <p className="mb-3 text-sm font-semibold text-[#3083FF]">Pilih atau isi jawaban yang benar</p>
                                    <QuestionRenderer key={`${data.revision}:${selected.id}`} question={selected} answer={drafts[selected.id]} onAnswerChange={answer => {
                                        setDrafts(current => ({ ...current, [selected.id]: typeof answer === 'string' ? answer : JSON.stringify(answer) }));
                                    }} />
                                </> : <p className="text-sm text-slate-500">Soal esai dinilai manual sehingga tidak memiliki kunci, tetapi tetap dapat dibatalkan.</p>}
                        </fieldset>}
                        <div className="exam-key-correction__notes">
                            <label className="text-sm font-semibold text-slate-600" htmlFor="correction-reason">Catatan koreksi</label>
                            <textarea id="correction-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} maxLength={1000} rows={5} className="w-full border border-slate-200 rounded-lg p-3 text-sm" placeholder="Jelaskan kunci yang diperbaiki atau alasan soal dibatalkan…" />
                            <p className="text-xs text-slate-400">Esai tetap dikoreksi manual. Soal kepribadian tidak menggunakan kunci benar/salah dan tidak dinilai.</p>
                        </div>
                    </>}
                    {data.history.length > 0 && <details className="mt-5 border-t border-slate-100 pt-3 text-sm text-slate-600">
                        <summary className="cursor-pointer font-semibold">Riwayat koreksi ({data.history.length})</summary>
                        {[...data.history].reverse().map(entry => <div key={entry.revision} className="mt-3 border-b border-slate-100 pb-2">
                            <p className="font-semibold">Revisi {entry.revision} · {entry.changes.length} kunci{entry.voids?.length
                                ? ` · ${entry.voids.filter(item => item.excluded).length} dibatalkan · ${entry.voids.filter(item => !item.excluded).length} dipulihkan` : ''}</p>
                            <p>{entry.reason}</p><p className="text-xs text-slate-400">{formatSchoolDateTime(entry.at, timeZone)}</p>
                        </div>)}
                    </details>}
                </>}
            </ModalBody>
            <ModalFooter>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Tutup</Button>
                <Button disabled={busy || !data || (!pending && !reason.trim())} onClick={() => void save()}>{busy ? 'Memproses…' : pending ? 'Lanjutkan Penilaian Ulang' : 'Simpan Kunci & Hitung Ulang'}</Button>
            </ModalFooter>
        </Modal>}
    </>;
}
