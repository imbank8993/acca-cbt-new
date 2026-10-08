'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Plus, RotateCcw, Search } from 'lucide-react';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { InlineSelect } from '@/components/ui/InlineSelect';
import '@/app/components/learning/learning.css';

export default function LearningLibrary() {
    const [manage, setManage] = useState(false);
    return <LearningLibraryContent key={String(manage)} manage={manage} setManage={setManage} />;
}

function LearningLibraryContent({ manage, setManage }: { manage: boolean; setManage: (value: boolean) => void }) {
    const request = useRef<AbortController | null>(null);
    const router = useRouter();
    const [materials, setMaterials] = useState<LearningMaterial[]>([]);
    const [canManage, setCanManage] = useState(false);
    const [query, setQuery] = useState('');
    const [grade, setGrade] = useState('');
    const [subject, setSubject] = useState('');
    const [topic, setTopic] = useState('');
    const [subtopic, setSubtopic] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);
    const createId = useRef('');

    const load = useCallback(async () => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError('');
        try {
            const data = await learningRequest<{ materials: LearningMaterial[]; canManage: boolean }>(manage ? '?manage=1' : '', { signal: controller.signal });
            if (controller.signal.aborted) return;
            setMaterials(data.materials);
            setCanManage(data.canManage);
        } catch (err) {
            if (!controller.signal.aborted) setError((err as Error).message);
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [manage]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => { window.clearTimeout(timer); request.current?.abort(); };
    }, [load]);

    const create = async () => {
        setCreating(true);
        setError('');
        createId.current ||= crypto.randomUUID();
        try {
            const data = await learningRequest<{ material: LearningMaterial }>('', {
                method: 'POST',
                body: JSON.stringify({ id: createId.current, title: 'Bahan ajar baru' })
            });
            router.push(`/dashboard/learning/${data.material.id}/edit`);
        } catch (err) {
            setError((err as Error).message);
            setCreating(false);
        }
    };

    const normalized = (value: string) => value.trim().toLocaleLowerCase('id-ID');
    const equal = (a: string, b: string) => normalized(a || '') === normalized(b);

    const grades = useMemo(() => {
        return materials.filter(item => !grade || (grade === 'general' ? !item.grade_level : item.grade_level === grade));
    }, [materials, grade]);

    const subjects = useMemo(() => {
        return grades.filter(item => !subject || equal(item.subject, subject));
    }, [grades, subject]);

    const topics = useMemo(() => {
        return subjects.filter(item => !topic || equal(item.topic, topic));
    }, [subjects, topic]);

    const options = (items: LearningMaterial[], key: 'subject' | 'topic' | 'subtopic') =>
        Array.from(new Map(items.filter(item => item[key]?.trim()).map(item => [normalized(item[key]), item[key].trim()])).values())
            .sort((a, b) => a.localeCompare(b, 'id'));

    const gradeOptions = useMemo(() => [
        { value: '', label: 'Semua kelas' },
        { value: 'general', label: 'Materi lintas kelas' },
        ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Kelas ${i + 1}` }))
    ], []);

    const subjectOptions = useMemo(() => [
        { value: '', label: 'Semua mata pelajaran' },
        ...options(grades, 'subject').map(val => ({ value: val, label: val }))
    ], [grades]);

    const topicOptions = useMemo(() => [
        { value: '', label: 'Semua materi' },
        ...options(subjects, 'topic').map(val => ({ value: val, label: val }))
    ], [subjects]);

    const subtopicOptions = useMemo(() => [
        { value: '', label: 'Semua submateri' },
        ...options(topics, 'subtopic').map(val => ({ value: val, label: val }))
    ], [topics]);

    const filtered = !!(query || grade || subject || topic || subtopic);

    const visible = useMemo(() => {
        return topics.filter(item =>
            (!subtopic || equal(item.subtopic, subtopic)) &&
            `${item.title} ${item.subject} ${item.topic || ''} ${item.subtopic || ''} ${item.description}`
                .toLowerCase()
                .includes(query.trim().toLowerCase())
        );
    }, [topics, subtopic, query]);

    return (
        <main className="learning">
            <div className="learn-toolbar">
                <div className="learn-tabs">
                    <button aria-pressed={!manage} onClick={() => setManage(false)}>
                        Semua materi
                        <span className="learn-tab-count">{materials.length}</span>
                    </button>
                    {canManage && (
                        <button aria-pressed={manage} onClick={() => setManage(true)}>
                            Kelola materi
                        </button>
                    )}
                </div>
                <div className="learn-toolbar-right">
                    <div className="learn-search">
                        <Search size={15} />
                        <input
                            aria-label="Cari bahan ajar"
                            placeholder="Cari judul atau mata pelajaran"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                    </div>
                    {canManage && manage && (
                        <button className="learn-primary" disabled={creating} onClick={() => void create()}>
                            <Plus size={16} />
                            {creating ? 'Menyiapkan draf…' : 'Tambah bahan ajar'}
                        </button>
                    )}
                </div>
            </div>

            <section className="learn-filters" aria-label="Filter bahan ajar">
                <div className="learn-field">
                    <label htmlFor="filter-grade">Tingkatan kelas</label>
                    <InlineSelect
                        id="filter-grade"
                        aria-label="Tingkatan kelas"
                        value={grade}
                        onChange={value => {
                            setGrade(value);
                            setSubject('');
                            setTopic('');
                            setSubtopic('');
                        }}
                        options={gradeOptions}
                        height="38px"
                        minWidth="100%"
                    />
                </div>
                <div className="learn-field">
                    <label htmlFor="filter-subject">Mata pelajaran</label>
                    <InlineSelect
                        id="filter-subject"
                        aria-label="Mata pelajaran"
                        value={subject}
                        onChange={value => {
                            setSubject(value);
                            setTopic('');
                            setSubtopic('');
                        }}
                        options={subjectOptions}
                        height="38px"
                        minWidth="100%"
                    />
                </div>
                <div className="learn-field">
                    <label htmlFor="filter-topic">Materi</label>
                    <InlineSelect
                        id="filter-topic"
                        aria-label="Materi"
                        value={topic}
                        onChange={value => {
                            setTopic(value);
                            setSubtopic('');
                        }}
                        options={topicOptions}
                        height="38px"
                        minWidth="100%"
                    />
                </div>
                <div className="learn-field">
                    <label htmlFor="filter-subtopic">Submateri</label>
                    <InlineSelect
                        id="filter-subtopic"
                        aria-label="Submateri"
                        value={subtopic}
                        onChange={value => setSubtopic(value)}
                        options={subtopicOptions}
                        height="38px"
                        minWidth="100%"
                    />
                </div>
                {filtered && (
                    <button
                        type="button"
                        className="learn-reset-btn"
                        onClick={() => {
                            setQuery('');
                            setGrade('');
                            setSubject('');
                            setTopic('');
                            setSubtopic('');
                        }}
                    >
                        <RotateCcw size={14} />
                        Reset filter
                    </button>
                )}
                {!loading && (
                    <small role="status">{visible.length} dari {materials.length} bahan ajar</small>
                )}
            </section>

            {error && (
                <div className="learn-error" role="alert">
                    {error}
                    <button onClick={() => void load()}>Coba lagi</button>
                </div>
            )}

            {loading ? (
                <div className="learn-loading" role="status">Memuat bahan ajar…</div>
            ) : visible.length ? (
                <div className="learn-grid">
                    {visible.map(item => (
                        <article className="learn-card" key={item.id}>
                            {(manage || item.completed) && (
                                <div className="learn-card-top">
                                    {manage ? (
                                        <span className={`learn-status ${item.status}`}>
                                            {item.status === 'published' ? 'Terbit' : 'Draf'}
                                        </span>
                                    ) : (
                                        item.completed && (
                                            <CheckCircle2 size={19} color="#3083FF" aria-label="Selesai dipelajari" />
                                        )
                                    )}
                                </div>
                            )}
                            <div className="learn-card-body">
                                {item.materialUpdated && (
                                    <span className="learn-status">Materi diperbarui</span>
                                )}
                                <h2>
                                    <Link href={`/dashboard/learning/${item.id}`}>{item.title}</Link>
                                </h2>
                                <p>{item.description || 'Buka bahan ajar untuk mulai mempelajari isinya.'}</p>
                            </div>
                            <footer className="learn-card-footer">
                                <span className="learn-date">
                                    {new Date(item.updated_at).toLocaleDateString('id-ID', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric'
                                    })}
                                </span>
                                <Link href={`/dashboard/learning/${item.id}${manage ? '/edit' : ''}`}>
                                    {manage ? 'Kelola' : 'Mulai belajar'}
                                    <ArrowRight size={15} />
                                </Link>
                            </footer>
                        </article>
                    ))}
                </div>
            ) : !error && (
                <div className="learn-empty">
                    <BookOpen size={42} />
                    <h2>{filtered ? 'Materi tidak ditemukan' : 'Belum ada bahan ajar'}</h2>
                    <p>
                        {filtered
                            ? 'Coba kata kunci atau filter lain.'
                            : manage
                            ? 'Tambahkan dokumen pertama untuk memulai.'
                            : 'Materi yang diterbitkan guru akan muncul di sini.'}
                    </p>
                </div>
            )}
        </main>
    );
}
