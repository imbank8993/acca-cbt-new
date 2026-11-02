'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { chapterKey, learningGrades, learningKey, type LearningChapter } from '@/lib/learning-catalog';

export function CreateSubchapterModal({ materials, chapter, initialGrade = '10', onClose }: { materials: LearningMaterial[]; chapter?: LearningChapter; initialGrade?: string; onClose: () => void }) {
    const router = useRouter();
    const requestId = useRef('');
    const [grade, setGrade] = useState(chapter ? chapter.grade : initialGrade);
    const [subject, setSubject] = useState(chapter?.subject || '');
    const [topic, setTopic] = useState(chapter?.title === 'Belum dikelompokkan' ? '' : chapter?.title || '');
    const [title, setTitle] = useState('');
    const [order, setOrder] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const matching = materials.filter(item => chapterKey(item) === chapterKey({ grade_level: grade, subject, topic }));
    const nextOrder = Math.max(0, ...matching.map(item => item.subtopic_order || 0), matching.length) + 1;
    const subjects = [...new Set(materials.map(item => item.subject).filter(Boolean))];
    const chapters = [...new Map(materials.filter(item => (item.grade_level || '') === grade && learningKey(item.subject) === learningKey(subject) && item.topic?.trim())
        .map(item => [learningKey(item.topic), item.topic.trim()])).values()];
    const create = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (!subject.trim() || !topic.trim() || !title.trim()) { setError('Mata pelajaran, BAB, dan judul subbab wajib diisi.'); return; }
        setBusy(true); setError(''); requestId.current ||= crypto.randomUUID();
        try {
            const canonicalTopic = chapters.find(item => learningKey(item) === learningKey(topic)) || topic.trim();
            const result = await learningRequest<{ material: LearningMaterial }>('', { method: 'POST', body: JSON.stringify({
                id: requestId.current, title: title.trim(), subtopic: title.trim(), subject: subject.trim(), gradeLevel: grade,
                topic: canonicalTopic, subtopicOrder: Number(order || nextOrder),
            }) });
            router.push(`/dashboard/learning/${result.material.id}/edit`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
    };
    return <Modal open onClose={() => { if (!busy) onClose(); }} title="Tambah subbab" subtitle="Satu file untuk satu subbab. Pilih BAB yang sudah ada atau buat BAB baru." size="md">
        <form onSubmit={event => void create(event)}>
            <ModalBody className="learn-create-form">
                <div className="learn-create-grid">
                    <label>Tingkatan kelas<select value={grade} onChange={event => { setGrade(event.target.value); setTopic(''); setOrder(''); }}>{learningGrades.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}{grade && !learningGrades.some(item => item.value === grade) && <option value={grade}>Kelas {grade}</option>}</select></label>
                    <label>Mata pelajaran<input required maxLength={100} list="new-subchapter-subjects" value={subject} onChange={event => { setSubject(event.target.value); setTopic(''); setOrder(''); }} placeholder="Matematika" /></label>
                </div>
                <datalist id="new-subchapter-subjects">{subjects.map(item => <option key={item} value={item} />)}</datalist>
                <label>BAB<input required maxLength={200} list="new-subchapter-chapters" value={topic} onChange={event => { setTopic(event.target.value); setOrder(''); }} placeholder="Contoh: Fungsi" /></label>
                <datalist id="new-subchapter-chapters">{chapters.map(item => <option key={item} value={item} />)}</datalist>
                {chapters.length > 0 && <div className="learn-chapter-suggestions" aria-label="Pilih BAB yang sudah ada">{chapters.map(item => <button type="button" key={item} aria-pressed={learningKey(topic) === learningKey(item)} onClick={() => { setTopic(item); setOrder(''); }}>{item}</button>)}</div>}
                <div className="learn-create-grid learn-create-grid--title">
                    <label>Judul subbab<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Definisi fungsi" /></label>
                    <label>Urutan<input required type="number" min={1} max={9999} value={order || nextOrder} onChange={event => setOrder(event.target.value)} /></label>
                </div>
                <p className="learn-create-hint">{matching.length ? `BAB ini sudah memiliki ${matching.length} subbab. Subbab baru akan ditambahkan ke BAB yang sama.` : 'BAB akan muncul setelah subbab pertamanya dibuat.'} Unggah file HTML atau dokumen pada langkah berikutnya.</p>
                {error && <div className="learn-error" role="alert">{error}</div>}
            </ModalBody>
            <ModalFooter align="between"><Button type="button" variant="cancel" disabled={busy} onClick={onClose}>Batal</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Menyiapkan…' : 'Lanjut unggah file'}</Button></ModalFooter>
        </form>
    </Modal>;
}
