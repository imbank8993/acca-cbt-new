'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, FileText, Plus, Search, Trash2 } from 'lucide-react';
import { deleteMaterial, learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { groupLearningChapters, learningGradeLabel, learningGrades, learningKey, type LearningChapter } from '@/lib/learning-catalog';
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { CreateSubchapterModal } from '@/app/components/learning/CreateSubchapterModal';
import '@/app/components/learning/learning.css';

/** Singkatan mata pelajaran yang umum; mapel lain memakai inisial kata atau tiga huruf pertama. */
const SUBJECT_ABBR: Record<string, string> = {
    matematika: 'MTK', fisika: 'FIS', kimia: 'KIM', biologi: 'BIO', informatika: 'INF',
    'bahasa indonesia': 'BIN', 'bahasa inggris': 'BIG', 'bahasa arab': 'BAR',
    sejarah: 'SEJ', geografi: 'GEO', ekonomi: 'EKO', sosiologi: 'SOS',
};
const SUBJECT_HUES = [217, 160, 262, 24, 330, 190, 45, 290];

/** Penanda kartu BAB: singkatan dan rona warna yang selalu sama untuk satu mata pelajaran. */
function subjectMark(subject: string): { abbr: string; style: CSSProperties } {
    const key = learningKey(subject);
    const words = key.split(' ').filter(Boolean);
    const abbr = (SUBJECT_ABBR[key] || (words.length > 1 ? words.slice(0, 3).map(word => word[0]).join('') : key.slice(0, 3))).toUpperCase() || '—';
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return { abbr, style: { '--mark-hue': SUBJECT_HUES[hash % SUBJECT_HUES.length] } as CSSProperties };
}

function chapterStatus(chapter: LearningChapter, manage: boolean): { label: string; tone: 'idle' | 'progress' | 'done' | 'draft' } {
    if (manage) {
        const drafts = chapter.items.filter(item => item.status === 'draft').length;
        return drafts ? { label: `${drafts} draf`, tone: 'draft' } : { label: 'Terbit', tone: 'done' };
    }
    if (chapter.completed === chapter.items.length) return { label: 'Selesai', tone: 'done' };
    if (chapter.completed) return { label: `${chapter.completed} dari ${chapter.items.length} subbab`, tone: 'progress' };
    return { label: 'Belum mulai', tone: 'idle' };
}

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
    const drafts = materials.filter(item => item.status === 'draft').length;
    // Kartu "Lanjutkan": BAB yang sedang dipelajari, atau BAB pertama yang belum selesai.
    const resume = useMemo(() => {
        if (manage) return null;
        const inProgress = chapters.find(chapter => chapter.completed > 0 && chapter.completed < chapter.items.length);
        const chapter = inProgress || chapters.find(chapter => chapter.completed < chapter.items.length);
        if (!chapter) return null;
        return { chapter, item: chapter.items.find(item => !item.completed) || chapter.items[0], started: Boolean(inProgress) };
    }, [chapters, manage]);
    const resumeMark = resume ? subjectMark(resume.chapter.subject) : null;
    const summary = loading ? 'Memuat…' : manage
        ? `${chapters.length} BAB · ${materials.length} subbab${drafts ? ` · ${drafts} draf` : ''}`
        : `${chapters.length} BAB · ${completed} dari ${materials.length} subbab selesai`;

    return <main className="learning learn-library">
        <header className="lc-header">
            <div>
                <h1>{manage ? 'Kelola materi' : 'Ruang belajar'}</h1>
                <p>{summary}</p>
            </div>
            {canManage && <div className="lc-header-actions">
                <div className="lc-segmented" role="group" aria-label="Tampilan bahan ajar">
                    <button type="button" aria-pressed={!manage} onClick={() => setManage(false)}>Ruang belajar</button>
                    <button type="button" aria-pressed={manage} onClick={() => setManage(true)}>Kelola materi</button>
                </div>
                {manage && <button type="button" className="learn-primary lc-add" onClick={() => setCreating({})}><Plus size={16} />Tambah subbab</button>}
            </div>}
        </header>

        {!loading && resume && resumeMark && <section className="lc-continue" aria-label="Lanjutkan belajar">
            <span className="lc-mark" style={resumeMark.style} aria-hidden="true">{resumeMark.abbr}</span>
            <div className="lc-continue-text">
                <span>{resume.started ? 'Lanjutkan belajar' : 'Mulai dari sini'}</span>
                <strong>{resume.item.subtopic || resume.item.title}</strong>
                <small>{resume.chapter.subject} · {resume.chapter.title} · {learningGradeLabel(resume.chapter.grade)}</small>
            </div>
            <Link className="lc-continue-action" href={`/dashboard/learning/${resume.item.id}`}>{resume.started ? 'Lanjutkan' : 'Mulai'}<ArrowRight size={15} /></Link>
        </section>}

        <div className="lc-controls">
            <nav className="lc-tabs" aria-label="Tingkatan kelas">{gradeChoices.map(item => {
                const count = chapters.filter(chapter => item.value === 'all' || chapter.grade === item.value).length;
                return <button type="button" key={item.value} aria-pressed={grade === item.value} className={count ? undefined : 'is-empty'}
                    onClick={() => { setGrade(item.value); setSubject(''); }}>{item.label}<span className="lc-tab-count">{count}</span></button>;
            })}</nav>
            <div className="lc-filters">
                <label className="lc-search"><Search size={16} aria-hidden="true" /><input aria-label="Cari BAB atau subbab" placeholder="Cari BAB, subbab, atau mata pelajaran…" value={query} onChange={event => setQuery(event.target.value)} /></label>
                <select className="lc-select" aria-label="Mata pelajaran" value={subject} onChange={event => setSubject(event.target.value)}><option value="">Semua mata pelajaran</option>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select>
            </div>
        </div>

        {error && <div className="learn-error" role="alert">{error}<button type="button" onClick={() => void load()}>Coba lagi</button></div>}
        {loading ? <div className="learn-loading" role="status">Memuat ruang belajar…</div> : visible.length ? gradeGroups.map(group => <section key={group} className="lc-section" aria-label={learningGradeLabel(group)}>
            <header className="lc-section-heading"><h2>{learningGradeLabel(group)}</h2><span>{visible.filter(chapter => chapter.grade === group).length} BAB</span></header>
            <div className="lc-grid">{visible.filter(chapter => chapter.grade === group).map(chapter => {
                const isOpen = expanded.has(chapter.key) || !!query.trim();
                const percent = Math.round(chapter.completed / chapter.items.length * 100);
                const next = chapter.items.find(item => !item.completed) || chapter.items[0];
                const status = chapterStatus(chapter, manage);
                const mark = subjectMark(chapter.subject);
                const listId = `subchapters-${chapter.items[0].id}`;
                const toggle = () => setExpanded(previous => { const copy = new Set(previous); if (copy.has(chapter.key)) copy.delete(chapter.key); else copy.add(chapter.key); return copy; });
                return <article className={`lc-card${isOpen ? ' is-open' : ''}`} key={chapter.key}>
                    <div className="lc-card-main">
                        <span className="lc-mark" style={mark.style} aria-hidden="true">{mark.abbr}</span>
                        <div className="lc-card-body">
                            <span className="lc-card-subject">{chapter.subject}</span>
                            <h3>{manage
                                ? <button type="button" className="lc-card-title" aria-expanded={isOpen} aria-controls={listId} onClick={toggle}>{chapter.title}</button>
                                : <Link className="lc-card-title" href={`/dashboard/learning/${next.id}`}>{chapter.title}</Link>}</h3>
                            <div className="lc-card-meta">
                                <span className={`lc-status is-${status.tone}`}>{status.tone === 'done' && <CheckCircle2 size={12} aria-hidden="true" />}{status.label}</span>
                                <span>{chapter.items.length} subbab</span>
                            </div>
                        </div>
                    </div>
                    {!manage && <div className="lc-progress" role="progressbar" aria-label={`Progres BAB ${chapter.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
                    <div className="lc-card-footer">
                        <button type="button" className="lc-toggle" aria-expanded={isOpen} aria-controls={listId} onClick={toggle}>Daftar subbab<ChevronDown size={15} className={isOpen ? 'learn-chevron-open' : ''} /></button>
                        {manage
                            ? <button type="button" className="lc-link" onClick={() => setCreating({ chapter })}><Plus size={14} />Subbab</button>
                            : <Link className="lc-link" href={`/dashboard/learning/${next.id}`}>{chapter.completed ? chapter.completed === chapter.items.length ? 'Pelajari ulang' : 'Lanjutkan' : 'Mulai belajar'}<ArrowRight size={14} /></Link>}
                    </div>
                    {isOpen && <ol className="learn-subchapter-list" id={listId}>{chapter.items.map((item, index) => <li key={item.id}>
                        <span className={`learn-subchapter-number ${item.completed ? 'is-complete' : ''}`}>{item.completed ? <CheckCircle2 size={14} /> : item.subtopic_order || index + 1}</span>
                        <Link className="learn-subchapter-link" href={`/dashboard/learning/${item.id}${manage ? '/edit' : ''}`}><strong>{item.subtopic || item.title}</strong><span><FileText size={12} />{item.format.toUpperCase()}{manage ? ` · ${item.status === 'published' ? 'Terbit' : 'Draf'}` : item.materialUpdated ? ' · Diperbarui' : item.completed ? ' · Selesai dipelajari' : ''}</span></Link>
                        {manage ? <button type="button" className="learn-btn-icon-danger" aria-label={`Hapus subbab ${item.subtopic || item.title}`} disabled={deletingId === item.id} onClick={() => void remove(item)}><Trash2 size={14} /></button> : <ArrowRight size={15} />}
                    </li>)}</ol>}
                </article>;
            })}</div>
        </section>) : !error && <div className="learn-empty"><BookOpen size={36} /><h2>{query || subject ? 'BAB tidak ditemukan' : 'Belum ada BAB untuk kelas ini'}</h2><p>{manage ? 'Tambahkan subbab pertama, lalu pilih nama BAB-nya.' : 'BAB dan subbab yang diterbitkan guru akan muncul di sini.'}</p>{query || subject ? <button type="button" onClick={() => { setQuery(''); setSubject(''); }}>Hapus pencarian</button> : null}</div>}
        {creating && <CreateSubchapterModal materials={materials} chapter={creating.chapter} initialGrade={grade === 'all' ? '10' : grade} onClose={() => setCreating(null)} />}
    </main>;
}
