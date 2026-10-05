'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';

type Branch = { label: string; children: Map<string, Branch>; materials: LearningMaterial[] };
function group(items: LearningMaterial[]) {
    const root: Branch = { label: '', children: new Map(), materials: [] };
    for (const item of items) {
        let node = root;
        for (const label of [item.subject?.trim() || 'Mata pelajaran umum', item.topic?.trim() || 'Materi umum', item.subtopic?.trim() || 'Tanpa submateri']) {
            const key = label.toLocaleLowerCase('id-ID');
            if (!node.children.has(key)) node.children.set(key, { label, children: new Map(), materials: [] });
            node = node.children.get(key)!;
        }
        node.materials.push(item);
    }
    return root;
}
function contains(node: Branch, id: string): boolean {
    return node.materials.some(item => item.id === id) || Array.from(node.children.values()).some(child => contains(child, id));
}
function Branches({ node, currentId, navigate }: { node: Branch; currentId: string; navigate: () => void }) {
    return <ul>{Array.from(node.children.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label, 'id')).map(([key, child]) => <li key={key}>
        <details open={contains(child, currentId)}><summary>{child.label}</summary><Branches node={child} currentId={currentId} navigate={navigate} /></details>
    </li>)}{[...node.materials].sort((a, b) => a.title.localeCompare(b.title, 'id')).map(item => <li key={item.id}>
        <Link href={`/dashboard/learning/${item.id}`} aria-current={item.id === currentId ? 'page' : undefined} onClick={navigate}>{item.title}<small>{item.grade_level ? `Kelas ${item.grade_level}` : 'Lintas kelas'}{item.status === 'draft' ? ' · Draf' : ''}</small></Link>
    </li>)}</ul>;
}
export function LearningNavigation({ current, open, close, navigate }: { current: LearningMaterial | null; open: boolean; close: () => void; navigate: () => void }) {
    const [items, setItems] = useState<LearningMaterial[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true); setError('');
        try { const result = await learningRequest<{ materials: LearningMaterial[] }>('', { signal }); if (!signal?.aborted) setItems(result.materials); }
        catch { if (!signal?.aborted) setError('Daftar bahan ajar belum dapat dimuat.'); }
        finally { if (!signal?.aborted) setLoading(false); }
    }, []);
    useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
    const all = current ? [...items.filter(item => item.id !== current.id), current] : items;
    return <aside id="learning-navigation" className="learn-navigation" hidden={!open}>
        <header><h2>Daftar bahan ajar</h2><button aria-label="Tutup navigasi bahan ajar" onClick={close}><X size={18} /></button></header>
        {loading && <p role="status">Memuat daftar…</p>}
        {error && <div role="alert"><p>{error}</p><button onClick={() => void load()}>Coba lagi</button></div>}
        {!loading && !error && <nav aria-label="Mata pelajaran, materi, dan submateri"><Branches key={current?.id} node={group(all)} currentId={current?.id || ''} navigate={navigate} />{!all.length && <p>Belum ada bahan ajar.</p>}</nav>}
    </aside>;
}
