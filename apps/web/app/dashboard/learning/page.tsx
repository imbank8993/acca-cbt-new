'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { deleteMaterial, learningRequest, type LearningMaterial } from '@/lib/learning-api';
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { FilterActions, FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Button } from '@/app/components/ui/button';
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
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const createId = useRef('');

    const handleDelete = async (item: LearningMaterial) => {
        if (!await deleteConfirmDialog('Hapus Bahan Ajar?', `Apakah Anda yakin ingin menghapus bahan ajar "${item.title}"? Seluruh berkas dan data terkait akan dihapus secara permanen.`)) return;
        setDeletingId(item.id);
        setError('');
        try {
            await deleteMaterial(item.id);
            setMaterials(prev => prev.filter(m => m.id !== item.id));
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setDeletingId(null);
        }
    };

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
            {canManage && (
                <div className="learn-toolbar">
                    <div className="learn-tabs" role="group" aria-label="Tampilan bahan ajar">
                        <button type="button" aria-pressed={!manage} onClick={() => setManage(false)}>
                            Semua materi
                            <span className="learn-tab-count">{materials.length}</span>
                        </button>
                        <button type="button" aria-pressed={manage} onClick={() => setManage(true)}>
                            Kelola materi
                        </button>
                    </div>
                    {manage && (
                        <button type="button" className="learn-primary" disabled={creating} onClick={() => void create()}>
                            <Plus size={16} />
                            {creating ? 'Menyiapkan draf…' : 'Tambah bahan ajar'}
                        </button>
                    )}
                </div>
            )}

            <section className="mb-4 flex flex-col gap-4" aria-label="Filter bahan ajar">
                <FilterToolbar>
                    <FilterSearch
                        label="Cari bahan ajar"
                        placeholder="Cari judul atau mata pelajaran"
                        value={query}
                        onChange={setQuery}
                    />
                    <FilterSelect
                        label="Tingkatan kelas"
                        value={grade}
                        onChange={value => {
                            setGrade(value);
                            setSubject('');
                            setTopic('');
                            setSubtopic('');
                        }}
                        options={gradeOptions}
                    />
                    <FilterSelect
                        label="Mata pelajaran"
                        value={subject}
                        onChange={value => {
                            setSubject(value);
                            setTopic('');
                            setSubtopic('');
                        }}
                        options={subjectOptions}
                    />
                    <FilterSelect
                        label="Materi"
                        value={topic}
                        onChange={value => {
                            setTopic(value);
                            setSubtopic('');
                        }}
                        options={topicOptions}
                    />
                    <FilterSelect
                        label="Submateri"
                        value={subtopic}
                        onChange={setSubtopic}
                        options={subtopicOptions}
                    />
                    {filtered && (
                        <FilterActions>
                            <Button
                                type="button"
                                variant="outline"
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
                            </Button>
                        </FilterActions>
                    )}
                </FilterToolbar>
                {!loading && (
                    <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{visible.length} dari {materials.length} bahan ajar</p>
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
                            {item.cover_data?.startsWith('data:image/jpeg;base64,') && <Link href={`/dashboard/learning/${item.id}`} aria-label={`Buka ${item.title}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className="learn-cover" src={item.cover_data} alt={`Cover ${item.title}`} loading="lazy" />
                            </Link>}
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
                                <div className="learn-card-footer-right">
                                    {manage && (
                                        <button
                                            type="button"
                                            className="learn-btn-icon-danger"
                                            title="Hapus bahan ajar"
                                            aria-label={`Hapus bahan ajar: ${item.title}`}
                                            disabled={deletingId === item.id}
                                            onClick={() => void handleDelete(item)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                    <Link href={`/dashboard/learning/${item.id}${manage ? '/edit' : ''}`}>
                                        {manage ? 'Kelola' : 'Mulai belajar'}
                                        <ArrowRight size={15} />
                                    </Link>
                                </div>
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
