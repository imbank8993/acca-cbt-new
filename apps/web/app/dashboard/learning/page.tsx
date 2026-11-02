'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, FileText, GraduationCap, Plus, Search, Trash2 } from 'lucide-react';
import { deleteMaterial, learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { groupLearningChapters, learningGradeLabel, learningGrades, learningKey, type LearningChapter } from '@/lib/learning-catalog';
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { CreateSubchapterModal } from '@/app/components/learning/CreateSubchapterModal';
import '@/app/components/learning/learning.css';

export default function LearningLibrary() {
    const [manage, setManage] = useState(false);
    return <LearningLibraryContent key={String(manage)} manage={manage} setManage={setManage} />;
}

function LearningLibraryContent({ manage, setManage }: { manage: boolean; setManage: (value: boolean) => void }) {
    const request = useRef<AbortController | null>(null);
    const [materials, setMaterials] = useState<LearningMaterial[]>([]);
    const [canManage, setCanManage] = useState(false);
    const [query, setQuery] = useState('');
    const [grade, setGrade] = useState('all');
    const [subject, setSubject] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState<{ chapter?: LearningChapter } | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const load = useCallback(async () => {
        request.current?.abort();
        const controller = new AbortController(); request.current = controller;
        setLoading(true); setError('');
        try {
            const data = await learningRequest<{ materials: LearningMaterial[]; canManage: boolean }>(manage ? '?manage=1' : '', { signal: controller.signal });
            if (!controller.signal.aborted) { setMaterials(data.materials); setCanManage(data.canManage); }
        } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
        finally { if (!controller.signal.aborted) setLoading(false); }
    }, [manage]);
    useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); request.current?.abort(); }; }, [load]);
    const remove = async (item: LearningMaterial) => {
        if (!await deleteConfirmDialog('Hapus subbab?', `Subbab “${item.subtopic || item.title}” beserta file dan progresnya akan dihapus. Subbab lain dalam BAB ini tetap tersedia.`)) return;
        setDeletingId(item.id); setError('');
        try { await deleteMaterial(item.id); setMaterials(previous => previous.filter(row => row.id !== item.id)); }
        catch (err) { setError((err as Error).message); }
        finally { setDeletingId(null); }
    };
    const chapters = useMemo(() => groupLearningChapters(materials), [materials]);
    const subjects = [...new Set(materials.filter(item => grade === 'all' || (item.grade_level || '') === grade).map(item => item.subject).filter(Boolean))].sort();
    const visible = chapters.filter(chapter => (grade === 'all' || chapter.grade === grade) && (!subject || learningKey(chapter.subject) === learningKey(subject)) &&
        learningKey([chapter.title, chapter.subject, ...chapter.items.map(item => `${item.title} ${item.subtopic} ${item.description}`)].join(' ')).includes(learningKey(query)));
    const gradeGroups = [...new Set(visible.map(chapter => chapter.grade))];
    const gradeChoices = [{ value: 'all', label: 'Semua' }, ...learningGrades,
        ...[...new Set(materials.map(item => item.grade_level).filter(value => value && !learningGrades.some(item => item.value === value)))].map(value => ({ value, label: learningGradeLabel(value) }))];
    const completed = materials.filter(item => item.completed).length;
    return <main className="learning learn-library">
        <section className="learn-catalog-hero">
            <div className="learn-catalog-hero-icon"><GraduationCap size={30} /></div>
            <div><span className="learn-eyebrow">RUANG BELAJAR</span><h1>{manage ? 'Susun materi, subbab demi subbab.' : 'Mau belajar apa hari ini?'}</h1><p>{manage ? 'Kelompokkan file ke dalam BAB agar siswa mudah mengikuti alurnya.' : 'Pilih kelas, jelajahi BAB, lalu pelajari subbab sesuai urutanmu.'}</p></div>
            <div className="learn-catalog-count"><strong>{chapters.length}</strong><span>BAB tersedia</span></div>
        </section>
        <div className="learn-toolbar">
            {canManage ? <div className="learn-tabs" role="group" aria-label="Tampilan bahan ajar"><button type="button" aria-pressed={!manage} onClick={() => setManage(false)}>Ruang belajar</button><button type="button" aria-pressed={manage} onClick={() => setManage(true)}>Kelola materi</button></div> : <p>{completed} dari {materials.length} subbab selesai dipelajari</p>}
            {canManage && manage && <button type="button" className="learn-primary" onClick={() => setCreating({})}><Plus size={16} />Tambah subbab</button>}
        </div>
        <nav className="learn-grade-tabs" aria-label="Tingkatan kelas">{gradeChoices.map(item => <button type="button" key={item.value} aria-pressed={grade === item.value} onClick={() => { setGrade(item.value); setSubject(''); }}><span>{item.label}</span><small>{materials.filter(row => item.value === 'all' || (row.grade_level || '') === item.value).length}</small></button>)}</nav>
        <div className="learn-catalog-filters">
            <label className="learn-catalog-search"><Search size={18} /><input aria-label="Cari BAB atau subbab" placeholder="Cari BAB, subbab, atau mata pelajaran…" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <select aria-label="Mata pelajaran" value={subject} onChange={event => setSubject(event.target.value)}><option value="">Semua mata pelajaran</option>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select>
        </div>
        {error && <div className="learn-error" role="alert">{error}<button type="button" onClick={() => void load()}>Coba lagi</button></div>}
        {loading ? <div className="learn-loading" role="status">Memuat ruang belajar…</div> : visible.length ? gradeGroups.map(group => <section key={group} className="learn-grade-section" aria-label={learningGradeLabel(group)}>
            <header className="learn-grade-heading"><h2>{learningGradeLabel(group)}</h2><span>{visible.filter(chapter => chapter.grade === group).length} BAB</span></header>
            <div className="learn-chapter-grid">{visible.filter(chapter => chapter.grade === group).map(chapter => {
                const isOpen = expanded.has(chapter.key) || !!query.trim();
                const percent = Math.round(chapter.completed / chapter.items.length * 100);
                const next = chapter.items.find(item => !item.completed) || chapter.items[0];
                const toggle = () => setExpanded(previous => { const copy = new Set(previous); if (copy.has(chapter.key)) copy.delete(chapter.key); else copy.add(chapter.key); return copy; });
                return <article className="learn-chapter-card" key={chapter.key}>
                    <div className="learn-chapter-summary"><div className="learn-chapter-icon"><BookOpen size={24} /></div><div><span className="learn-chapter-subject">{chapter.subject}</span><h3><button type="button" className="learn-chapter-title" aria-expanded={isOpen} aria-controls={`subchapters-${chapter.items[0].id}`} onClick={toggle}>{chapter.title}</button></h3><p>{chapter.items.length} subbab{manage ? ` · ${chapter.items.filter(item => item.status === 'draft').length} draf` : ` · ${chapter.completed} selesai`}</p></div></div>
                    {!manage && <div className="learn-chapter-progress"><div role="progressbar" aria-label={`Progres BAB ${chapter.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div><small>{percent}%</small></div>}
                    <div className="learn-chapter-actions"><button type="button" aria-expanded={isOpen} aria-controls={`subchapters-${chapter.items[0].id}`} onClick={toggle}>Daftar subbab<ChevronDown size={16} className={isOpen ? 'learn-chevron-open' : ''} /></button>{manage ? <button type="button" onClick={() => setCreating({ chapter })}><Plus size={15} />Subbab</button> : <Link href={`/dashboard/learning/${next.id}`}>{chapter.completed ? chapter.completed === chapter.items.length ? 'Pelajari ulang' : 'Lanjutkan' : 'Mulai belajar'}<ArrowRight size={15} /></Link>}</div>
                    {isOpen && <ol className="learn-subchapter-list" id={`subchapters-${chapter.items[0].id}`}>{chapter.items.map((item, index) => <li key={item.id}>
                        <span className={`learn-subchapter-number ${item.completed ? 'is-complete' : ''}`}>{item.completed ? <CheckCircle2 size={18} /> : item.subtopic_order || index + 1}</span>
                        <Link className="learn-subchapter-link" href={`/dashboard/learning/${item.id}${manage ? '/edit' : ''}`}><strong>{item.subtopic || item.title}</strong><span><FileText size={12} />{item.format.toUpperCase()}{manage ? ` · ${item.status === 'published' ? 'Terbit' : 'Draf'}` : item.materialUpdated ? ' · Diperbarui' : item.completed ? ' · Selesai dipelajari' : ''}</span></Link>
                        {manage ? <button type="button" className="learn-btn-icon-danger" aria-label={`Hapus subbab ${item.subtopic || item.title}`} disabled={deletingId === item.id} onClick={() => void remove(item)}><Trash2 size={14} /></button> : <ArrowRight size={15} />}
                    </li>)}</ol>}
                </article>;
            })}</div>
        </section>) : !error && <div className="learn-empty"><BookOpen size={42} /><h2>{query || subject ? 'BAB tidak ditemukan' : 'Belum ada BAB untuk kelas ini'}</h2><p>{manage ? 'Tambahkan subbab pertama, lalu pilih nama BAB-nya.' : 'BAB dan subbab yang diterbitkan guru akan muncul di sini.'}</p>{query || subject ? <button type="button" onClick={() => { setQuery(''); setSubject(''); }}>Hapus pencarian</button> : null}</div>}
        {creating && <CreateSubchapterModal materials={materials} chapter={creating.chapter} initialGrade={grade === 'all' ? '10' : grade} onClose={() => setCreating(null)} />}
    </main>;
}
