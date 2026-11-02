'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react';
import { Modal, ModalBody, ModalField, ModalFileInput, ModalFooter } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { listSubjects } from '@/lib/api/proctor';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { createSubchapterFromFile, planBulkDrafts, type BulkDraft } from '@/lib/learning-bulk';
import { chapterKey, learningGrades, learningKey, type LearningChapter } from '@/lib/learning-catalog';

const MANUAL = '__manual__';
const NEW_CHAPTER = '__new__';
type RowStatus = { state: 'waiting' | 'working' | 'done' | 'failed'; text: string };

/**
 * Tambah subbab: satu subbab (lanjut ke halaman edit untuk unggah file), atau banyak sekaligus
 * (satu berkas = satu subbab; judul & urutan ditebak dari nama berkas dan dapat dikoreksi).
 * Mata pelajaran diambil dari master mapel sekolah, dengan pilihan mengetik manual.
 */
export function CreateSubchapterModal({ materials, chapter, initialGrade = '10', onClose, onUploaded }: {
    materials: LearningMaterial[]; chapter?: LearningChapter; initialGrade?: string; onClose: () => void;
    /** Dipanggil setelah unggah massal menambahkan subbab, untuk memuat ulang daftar. */
    onUploaded?: () => void;
}) {
    const router = useRouter();
    const requestId = useRef('');
    const subjectInput = useRef<HTMLInputElement>(null);
    const topicInput = useRef<HTMLInputElement>(null);
    const [mode, setMode] = useState<'single' | 'bulk'>('single');
    const [grade, setGrade] = useState(chapter ? chapter.grade : initialGrade);
    const [subject, setSubject] = useState(chapter?.subject || '');
    const [masterSubjects, setMasterSubjects] = useState<string[]>([]);
    const [subjectManual, setSubjectManual] = useState(false);
    const [topic, setTopic] = useState(chapter?.title === 'Belum dikelompokkan' ? '' : chapter?.title || '');
    const [topicManual, setTopicManual] = useState(false);
    const [title, setTitle] = useState('');
    const [order, setOrder] = useState('');
    const [drafts, setDrafts] = useState<BulkDraft[]>([]);
    const [edited, setEdited] = useState(false);
    const [publish, setPublish] = useState(false);
    const [rows, setRows] = useState<Record<string, RowStatus>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        // Master mapel hanya memperkaya pilihan; bila gagal dimuat, mapel tetap bisa diketik manual.
        void listSubjects().then(list => { if (alive) setMasterSubjects(list.map(item => item.name?.trim()).filter(Boolean)); }).catch(() => undefined);
        return () => { alive = false; };
    }, []);

    const subjectOptions = useMemo(() => {
        const names = new Map<string, string>();
        for (const name of [...masterSubjects, ...materials.map(item => item.subject?.trim() || '')]) if (name && !names.has(learningKey(name))) names.set(learningKey(name), name);
        return [...names.values()].sort((a, b) => a.localeCompare(b, 'id'));
    }, [masterSubjects, materials]);
    const knownSubject = !subject || subjectOptions.some(item => learningKey(item) === learningKey(subject));
    const showSubjectInput = subjectManual || !knownSubject;

    const chapters = useMemo(() => [...new Map(materials.filter(item => (item.grade_level || '') === grade && learningKey(item.subject) === learningKey(subject) && item.topic?.trim())
        .map(item => [learningKey(item.topic), item.topic.trim()])).values()].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })), [materials, grade, subject]);
    const knownTopic = !topic || chapters.some(item => learningKey(item) === learningKey(topic));
    const showTopicInput = topicManual || !chapters.length || !knownTopic;

    const matching = materials.filter(item => chapterKey(item) === chapterKey({ grade_level: grade, subject, topic }));
    const nextOrder = Math.max(0, ...matching.map(item => item.subtopic_order || 0), matching.length) + 1;
    const canonicalTopic = chapters.find(item => learningKey(item) === learningKey(topic)) || topic.trim();
    const canonicalSubject = subjectOptions.find(item => learningKey(item) === learningKey(subject)) || subject.trim();

    // Urutan rencana mengikuti BAB yang dipilih selama guru belum mengubah barisnya sendiri.
    const started = Object.keys(rows).length > 0;
    useEffect(() => {
        if (edited || started) return;
        const timer = window.setTimeout(() => setDrafts(current => current.length ? planBulkDrafts(current.map(item => item.file), nextOrder) : current), 0);
        return () => window.clearTimeout(timer);
    }, [nextOrder, edited, started]);

    const resetChapterDependents = () => { setOrder(''); };
    const chooseSubject = (value: string) => {
        if (value === MANUAL) { setSubjectManual(true); setSubject(''); window.setTimeout(() => subjectInput.current?.focus(), 0); }
        else { setSubjectManual(false); setSubject(value); }
        setTopic(''); setTopicManual(false); resetChapterDependents();
    };
    const chooseTopic = (value: string) => {
        if (value === NEW_CHAPTER) { setTopicManual(true); setTopic(''); window.setTimeout(() => topicInput.current?.focus(), 0); }
        else { setTopicManual(false); setTopic(value); }
        resetChapterDependents();
    };

    const addFiles = (files: File[]) => {
        if (!files.length) return;
        setDrafts(current => {
            const start = Math.max(nextOrder, ...current.map(item => item.order + 1));
            return [...current, ...planBulkDrafts(files, start)];
        });
        setError('');
    };
    const updateDraft = (key: string, patch: Partial<BulkDraft>) => { setEdited(true); setDrafts(current => current.map(item => item.key === key ? { ...item, ...patch } : item)); };

    const validateChapter = () => {
        if (!canonicalSubject || !canonicalTopic) { setError('Mata pelajaran dan BAB wajib diisi.'); return false; }
        return true;
    };

    const createSingle = async () => {
        if (!validateChapter()) return;
        if (!title.trim()) { setError('Judul subbab wajib diisi.'); return; }
        setBusy(true); setError(''); requestId.current ||= crypto.randomUUID();
        try {
            const result = await learningRequest<{ material: LearningMaterial }>('', { method: 'POST', body: JSON.stringify({
                id: requestId.current, title: title.trim(), subtopic: title.trim(), subject: canonicalSubject, gradeLevel: grade,
                topic: canonicalTopic, subtopicOrder: Number(order || nextOrder),
            }) });
            router.push(`/dashboard/learning/${result.material.id}/edit`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
    };

    const uploadAll = async () => {
        if (!validateChapter()) return;
        const queue = drafts.filter(item => rows[item.key]?.state !== 'done');
        if (!queue.length) { setError('Pilih minimal satu berkas.'); return; }
        if (queue.some(item => !item.title.trim() || !Number.isInteger(item.order) || item.order < 1 || item.order > 9999)) { setError('Setiap baris perlu judul dan urutan 1–9999.'); return; }
        setBusy(true); setError('');
        let added = 0;
        for (const item of queue) {
            setRows(current => ({ ...current, [item.key]: { state: 'working', text: 'Menyiapkan…' } }));
            try {
                await createSubchapterFromFile({ file: item.file, title: item.title, order: item.order, grade, subject: canonicalSubject, topic: canonicalTopic, publish },
                    stage => setRows(current => ({ ...current, [item.key]: { state: 'working', text: stage } })));
                added++;
                setRows(current => ({ ...current, [item.key]: { state: 'done', text: publish ? 'Terbit' : 'Draf tersimpan' } }));
            } catch (err) {
                setRows(current => ({ ...current, [item.key]: { state: 'failed', text: (err as Error).message } }));
            }
        }
        setBusy(false);
        if (added) onUploaded?.();
    };

    const doneCount = drafts.filter(item => rows[item.key]?.state === 'done').length;
    const failedCount = drafts.filter(item => rows[item.key]?.state === 'failed').length;
    const remaining = drafts.length - doneCount;
    const finished = drafts.length > 0 && remaining === 0;

    return <Modal open onClose={() => { if (!busy) onClose(); }} title="Tambah subbab" size="lg" closeOnOverlayClick={!busy}
        subtitle={mode === 'single' ? 'Buat satu subbab, lalu unggah filenya di langkah berikutnya.' : 'Pilih beberapa file sekaligus — satu file menjadi satu subbab.'}>
        <form onSubmit={event => { event.preventDefault(); if (!busy) void (mode === 'single' ? createSingle() : uploadAll()); }}>
            <ModalBody className="lc-create">
                <div className="lc-mode" role="group" aria-label="Cara menambah subbab">
                    <button type="button" aria-pressed={mode === 'single'} disabled={busy} onClick={() => { setMode('single'); setError(''); }}>Satu subbab</button>
                    <button type="button" aria-pressed={mode === 'bulk'} disabled={busy} onClick={() => { setMode('bulk'); setError(''); }}>Banyak sekaligus</button>
                </div>
                <div className="lc-create-grid">
                    <ModalField label="Tingkatan kelas" required>
                        <InlineSelect aria-label="Tingkatan kelas" value={grade} disabled={busy} minWidth="100%" onChange={value => { setGrade(value); setTopic(''); setTopicManual(false); resetChapterDependents(); }}
                            options={[...learningGrades.map(item => ({ value: item.value, label: item.label })), ...(grade && !learningGrades.some(item => item.value === grade) ? [{ value: grade, label: `Kelas ${grade}` }] : [])]} />
                    </ModalField>
                    <ModalField label="Mata pelajaran" required hint={showSubjectInput ? 'Ketik nama mapel bila tidak ada di master mapel.' : undefined}>
                        <InlineSelect aria-label="Mata pelajaran" value={showSubjectInput ? MANUAL : subject} disabled={busy} minWidth="100%" onChange={chooseSubject}
                            options={[{ value: '', label: 'Pilih mata pelajaran…' }, ...subjectOptions.map(item => ({ value: item, label: item })), { value: MANUAL, label: 'Ketik mata pelajaran lain…' }]} />
                        {showSubjectInput && <input ref={subjectInput} aria-label="Nama mata pelajaran" required maxLength={100} value={subject} disabled={busy}
                            onChange={event => { setSubject(event.target.value); setTopic(''); resetChapterDependents(); }} placeholder="Contoh: Matematika Tingkat Lanjut" />}
                    </ModalField>
                </div>
                <ModalField label="BAB" required hint={matching.length ? `BAB ini sudah memiliki ${matching.length} subbab; subbab baru ditambahkan ke BAB yang sama.` : chapters.length ? undefined : 'Belum ada BAB untuk mapel ini. Ketik nama BAB baru.'}>
                    {chapters.length > 0 && <InlineSelect aria-label="BAB" value={showTopicInput ? NEW_CHAPTER : topic} disabled={busy || !subject.trim()} minWidth="100%" onChange={chooseTopic}
                        options={[{ value: '', label: 'Pilih BAB…' }, ...chapters.map(item => ({ value: item, label: item })), { value: NEW_CHAPTER, label: '+ BAB baru…' }]} />}
                    {showTopicInput && <input ref={topicInput} aria-label="Nama BAB" required maxLength={200} value={topic} disabled={busy}
                        onChange={event => { setTopic(event.target.value); resetChapterDependents(); }} placeholder="Contoh: Fungsi" />}
                </ModalField>

                {mode === 'single' ? <div className="lc-create-grid lc-create-grid--title">
                    <ModalField label="Judul subbab" required><input aria-label="Judul subbab" required maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="Definisi fungsi" /></ModalField>
                    <ModalField label="Urutan" required><input aria-label="Urutan subbab" required type="number" min={1} max={9999} value={order || nextOrder} disabled={busy} onChange={event => setOrder(event.target.value)} /></ModalField>
                </div> : <>
                    <ModalField label="File subbab" hint="Word, HTML, LaTeX, PDF, gambar, atau media — maks. 25 MB per file. Nomor di awal nama file (mis. “01_Definisi.docx”, “3.2 Daerah asal.html”) dipakai sebagai urutan; sisanya menjadi judul.">
                        <ModalFileInput files={[]} multiple disabled={busy} onPick={addFiles} placeholder="Pilih beberapa file atau jatuhkan di sini" />
                    </ModalField>
                    {drafts.length > 0 && <div className="lc-bulk" role="list" aria-label="Rencana subbab yang akan diunggah">
                        <div className="lc-bulk-head" aria-hidden="true"><span>Urutan</span><span>Judul subbab</span><span>Status</span><span /></div>
                        {[...drafts].sort((a, b) => a.order - b.order).map(item => {
                            const row = rows[item.key];
                            const locked = busy || row?.state === 'done';
                            return <div key={item.key} role="listitem" className={`lc-bulk-row${row ? ` is-${row.state}` : ''}`}>
                                <input type="number" min={1} max={9999} aria-label={`Urutan ${item.file.name}`} value={item.order} disabled={locked}
                                    onChange={event => updateDraft(item.key, { order: Number(event.target.value) })} />
                                <div className="lc-bulk-title">
                                    <input aria-label={`Judul subbab untuk ${item.file.name}`} maxLength={200} value={item.title} disabled={locked} onChange={event => updateDraft(item.key, { title: event.target.value })} />
                                    <small title={item.file.name}>{item.file.name} · {Math.max(1, Math.round(item.file.size / 1024))} KB</small>
                                </div>
                                <span className="lc-bulk-status" title={row?.text}>
                                    {row?.state === 'working' ? <><Loader2 size={13} className="lc-spin" aria-hidden="true" />{row.text}</>
                                        : row?.state === 'done' ? <><CheckCircle2 size={13} aria-hidden="true" />{row.text}</>
                                        : row?.state === 'failed' ? <><XCircle size={13} aria-hidden="true" />{row.text}</> : 'Siap'}
                                </span>
                                <button type="button" className="lc-bulk-remove" aria-label={`Hapus ${item.file.name} dari daftar`} disabled={locked}
                                    onClick={() => { setDrafts(current => current.filter(entry => entry.key !== item.key)); setRows(current => { const next = { ...current }; delete next[item.key]; return next; }); }}><Trash2 size={14} /></button>
                            </div>;
                        })}
                    </div>}
                    <label className="lc-bulk-publish"><input type="checkbox" checked={publish} disabled={busy} onChange={event => setPublish(event.target.checked)} />Langsung terbitkan untuk siswa setelah diunggah</label>
                    {(doneCount > 0 || failedCount > 0) && <p className="lc-bulk-summary" role="status">{doneCount} berhasil{failedCount ? ` · ${failedCount} gagal — perbaiki lalu klik “Unggah ulang yang gagal”` : ''}.</p>}
                </>}
                {error && <p className="lc-create-error" role="alert">{error}</p>}
            </ModalBody>
            <ModalFooter align="between">
                <Button type="button" variant="cancel" disabled={busy} onClick={onClose}>{finished ? 'Tutup' : 'Batal'}</Button>
                {mode === 'single'
                    ? <Button type="submit" variant="primary" disabled={busy} isLoading={busy}>{busy ? 'Menyiapkan…' : 'Lanjut unggah file'}</Button>
                    : <Button type="submit" variant="primary" disabled={busy || !drafts.length || finished} isLoading={busy}>
                        {busy ? `Mengunggah ${doneCount + failedCount + 1} dari ${drafts.length}…` : failedCount ? 'Unggah ulang yang gagal' : `Unggah ${remaining || drafts.length} subbab`}
                    </Button>}
            </ModalFooter>
        </form>
    </Modal>;
}
