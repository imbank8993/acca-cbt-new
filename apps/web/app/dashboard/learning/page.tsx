'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, FileText, Plus, Search } from 'lucide-react';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';
import '@/app/components/learning/learning.css';

export default function LearningLibrary() {
    const router = useRouter();
    const [materials, setMaterials] = useState<LearningMaterial[]>([]);
    const [canManage, setCanManage] = useState(false);
    const [manage, setManage] = useState(false);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);
    const createId = useRef('');
    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { const data = await learningRequest<{ materials: LearningMaterial[]; canManage: boolean }>(manage ? '?manage=1' : ''); setMaterials(data.materials); setCanManage(data.canManage); }
        catch (err) { setError((err as Error).message); }
        finally { setLoading(false); }
    }, [manage]);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    const create = async () => {
        setCreating(true); setError('');
        createId.current ||= crypto.randomUUID();
        try { const data = await learningRequest<{ material: LearningMaterial }>('', { method: 'POST', body: JSON.stringify({ id: createId.current, title: 'Bahan ajar baru' }) }); router.push(`/dashboard/learning/${data.material.id}/edit`); }
        catch (err) { setError((err as Error).message); setCreating(false); }
    };
    const visible = materials.filter(item => `${item.title} ${item.subject} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
    return <main className="learning">
        <header className="learn-header"><div><div className="learn-eyebrow">Ruang belajar</div><h1>Bahan ajar</h1><p>Pelajari materi, jelajahi aktivitas, dan lanjutkan belajar sesuai ritmemu.</p></div>
            {canManage && <button className="learn-primary" disabled={creating} onClick={() => void create()}><Plus size={18} />{creating ? 'Menyiapkan draf…' : 'Tambah bahan ajar'}</button>}</header>
        <section className="learn-hero"><div className="learn-hero-icon"><BookOpen size={32} /></div><div><h2>{manage ? 'Dari dokumen menjadi pengalaman belajar' : 'Satu tempat untuk terus belajar'}</h2><p>{manage ? 'Unggah dokumen, periksa hasilnya, lalu bagikan kepada seluruh siswa.' : 'Buka materi dari guru dan tandai setelah selesai dipelajari.'}</p></div><div className="learn-hero-stat"><strong>{materials.length}</strong><span>{manage ? 'materi dikelola' : 'materi tersedia'}</span></div></section>
        <div className="learn-toolbar"><div className="learn-tabs"><button aria-pressed={!manage} onClick={() => setManage(false)}>Semua materi</button>{canManage && <button aria-pressed={manage} onClick={() => setManage(true)}>Kelola materi</button>}</div><div className="learn-search"><Search size={18} /><input aria-label="Cari bahan ajar" placeholder="Cari judul atau mata pelajaran" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
        {error && <div className="learn-error" role="alert">{error}<button onClick={() => void load()}>Coba lagi</button></div>}
        {loading ? <div className="learn-loading" role="status">Memuat bahan ajar…</div> : visible.length ? <div className="learn-grid">{visible.map(item => <article className="learn-card" key={item.id}>
            <div className="learn-card-top"><span className="learn-format"><FileText size={15} />{item.format}</span>{manage ? <span className={`learn-status ${item.status}`}>{item.status === 'published' ? 'Terbit' : 'Draf'}</span> : item.completed && <CheckCircle2 size={19} color="#0f766e" aria-label="Selesai dipelajari" />}</div>
            <div className="learn-card-body"><div className="learn-subject">{item.subject || 'Materi umum'}</div><h2><Link href={`/dashboard/learning/${item.id}`}>{item.title}</Link></h2><p>{item.description || 'Buka bahan ajar untuk mulai mempelajari isinya.'}</p></div>
            <footer className="learn-card-footer"><span className="learn-date">{new Date(item.updated_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span><Link href={`/dashboard/learning/${item.id}${manage ? '/edit' : ''}`}>{manage ? 'Kelola' : 'Mulai belajar'}<ArrowRight size={15} /></Link></footer>
        </article>)}</div> : !error && <div className="learn-empty"><BookOpen size={42} /><h2>{query ? 'Materi tidak ditemukan' : 'Belum ada bahan ajar'}</h2><p>{query ? 'Coba kata kunci lain.' : manage ? 'Tambahkan dokumen pertama untuk memulai.' : 'Materi yang diterbitkan guru akan muncul di sini.'}</p></div>}
    </main>;
}
