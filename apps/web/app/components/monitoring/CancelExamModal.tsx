'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import { cancelExamAction, type ExamAttemptRecord, type OrganizationExam } from '@/lib/api/proctor';
import { alertDialog } from '@/lib/confirm-dialog';

export interface CancellableExam {
    id: string;
    /** Label di monitoring (mis. nama kelas pada folder PAS). */
    label: string;
    /** Judul ujian di server; dikirim sebagai konfirmasi. */
    title: string;
    working: number;
    participants: number;
    isPas: boolean;
}

const CONFIRM_WORD = 'BATALKAN';
const PRESET_REASONS = ['Salah jadwal', 'Salah paket soal', 'Gangguan teknis massal'];

export function CancelExamModal({ open, exams, onClose, onDone }: {
    open: boolean;
    exams: CancellableExam[];
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    if (!open || exams.length === 0) return null;
    return <CancelExamForm key={exams.map(exam => exam.id).join(',')} exams={exams} onClose={onClose} onDone={onDone} />;
}

function CancelExamForm({ exams, onClose, onDone }: { exams: CancellableExam[]; onClose: () => void; onDone: (message: string) => void }) {
    const [selected, setSelected] = useState<string[]>(exams.map(exam => exam.id));
    const [reason, setReason] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string[]>([]);

    const chosen = exams.filter(exam => selected.includes(exam.id) && !done.includes(exam.id));
    const working = chosen.reduce((sum, exam) => sum + exam.working, 0);
    const participants = chosen.reduce((sum, exam) => sum + exam.participants, 0);
    const anyPas = chosen.some(exam => exam.isPas);
    const ready = chosen.length > 0 && reason.trim().length >= 5 && confirmation.trim().toUpperCase() === CONFIRM_WORD;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!ready || submitting) return;
        setSubmitting(true);
        setError(null);
        const failures: string[] = [];
        const finished = [...done];
        let attempts = 0;
        for (const exam of chosen) {
            const result = await cancelExamAction(exam.id, reason.trim(), exam.title);
            if (result.success) {
                finished.push(exam.id);
                attempts += result.attemptCount;
            } else {
                failures.push(`${exam.label}: ${result.error}`);
            }
        }
        setDone(finished);
        setSubmitting(false);
        if (failures.length) {
            setError(`${failures.join(' · ')}${finished.length ? ' Ujian lain sudah dibatalkan; tekan lagi untuk mencoba yang gagal.' : ''}`);
            return;
        }
        onDone(`${finished.length > 1 ? `${finished.length} ujian` : 'Ujian'} dibatalkan. ${attempts} pengerjaan dihentikan dan diarsipkan; ` +
            'ujian ditarik ke draf. Perbaiki jadwal lalu terbitkan lagi agar siswa mengerjakan ulang dari awal.');
    };

    return (
        <Modal open onClose={submitting ? () => undefined : onClose} size="md" variant="delete" icon="x-octagon"
            title="Batalkan Ujian" subtitle="Untuk jadwal yang salah: semua siswa mengerjakan ulang dari awal">
            <form onSubmit={event => void submit(event)}>
                <ModalBody className="space-y-4">
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-900">
                        <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} className="shrink-0" />Yang terjadi bila dibatalkan</p>
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                            <li><strong>{working}</strong> siswa yang sedang mengerjakan langsung dikeluarkan dari ujian (paling lambat ±15 detik).</li>
                            <li>Jawaban dan nilai <strong>{participants}</strong> peserta dihapus dari rekap dan disimpan di arsip pembatalan.</li>
                            <li>Ujian ditarik ke draf. {anyPas
                                ? 'Untuk ujian PAS, perbaiki jadwal lalu aktifkan kembali kelasnya dari folder PAS.'
                                : 'Perbaiki jadwal lalu terbitkan lagi.'} Siswa mengerjakan dari awal.</li>
                        </ul>
                    </div>

                    {exams.length > 1 && (
                        <fieldset>
                            <legend className="mb-1.5 text-xs font-bold text-slate-700">Ujian yang dibatalkan</legend>
                            <div className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                                {exams.map(exam => (
                                    <label key={exam.id} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50">
                                        <span className="flex min-w-0 items-center gap-2">
                                            <input type="checkbox" disabled={submitting || done.includes(exam.id)}
                                                checked={selected.includes(exam.id)}
                                                onChange={event => setSelected(ids => event.target.checked ? [...ids, exam.id] : ids.filter(id => id !== exam.id))} />
                                            <span className="truncate font-medium text-slate-800">{exam.label}</span>
                                        </span>
                                        <span className="shrink-0 text-slate-500">
                                            {done.includes(exam.id) ? 'Dibatalkan' : `${exam.working} mengerjakan · ${exam.participants} peserta`}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}

                    <div>
                        <label htmlFor="cancel-exam-reason" className="mb-1.5 block text-xs font-bold text-slate-700">
                            Alasan pembatalan <span className="text-red-500">*</span>
                        </label>
                        <textarea id="cancel-exam-reason" rows={2} value={reason} disabled={submitting}
                            onChange={event => setReason(event.target.value)} maxLength={500}
                            placeholder="Mis. jadwal ujian salah, seharusnya besok pukul 07.30 (min. 5 karakter)"
                            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-100" />
                        <div className="mt-1.5 flex flex-wrap gap-1">
                            {PRESET_REASONS.map(preset => (
                                <button key={preset} type="button" disabled={submitting} onClick={() => setReason(preset)}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                                    {preset}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="cancel-exam-confirm" className="mb-1.5 block text-xs font-bold text-slate-700">
                            Ketik <span className="font-mono text-red-600">{CONFIRM_WORD}</span> untuk mengonfirmasi
                        </label>
                        <input id="cancel-exam-confirm" value={confirmation} disabled={submitting} autoComplete="off"
                            onChange={event => setConfirmation(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs uppercase text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
                    </div>

                    {error && (
                        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" /><span>{error}</span>
                        </div>
                    )}
                </ModalBody>
                <ModalFooter align="between">
                    <Button type="button" variant="cancel" onClick={onClose} disabled={submitting}>
                        {done.length ? 'Tutup' : 'Batal'}
                    </Button>
                    <Button type="submit" variant="danger" isLoading={submitting} disabled={!ready}>
                        {submitting ? 'Membatalkan…' : `Batalkan ${chosen.length > 1 ? `${chosen.length} ujian` : 'ujian'}`}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}

/**
 * Tombol "Batalkan ujian" untuk monitoring satu ujian (bukan folder). Muncul hanya
 * bagi pengelola ujian dan hanya bila ujian sudah dikerjakan siswa.
 */
export function CancelExamButton({ exam, attempts, onDone }: {
    exam: OrganizationExam | undefined;
    attempts: ExamAttemptRecord[];
    onDone: () => void;
}) {
    const [targets, setTargets] = useState<CancellableExam[]>([]);
    if (!exam || exam.canManage !== true) return null;
    const rows = attempts.filter(row => row.exam_id === exam.id && row.status !== 'belum');
    if (!rows.length && !targets.length) return null;
    const open = () => setTargets([{
        id: exam.id, label: exam.title, title: exam.title,
        working: rows.filter(row => row.status === 'in_progress').length, participants: rows.length,
        isPas: exam.metadata?.is_pas_exam === true,
    }]);
    return <>
        <button type="button" onClick={open}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
            <AlertTriangle size={13} aria-hidden="true" />Batalkan ujian
        </button>
        <CancelExamModal open={targets.length > 0} exams={targets}
            onClose={() => { setTargets([]); onDone(); }}
            onDone={message => {
                setTargets([]);
                onDone();
                void alertDialog({ title: 'Ujian Dibatalkan', text: message, variant: 'success' });
            }} />
    </>;
}
