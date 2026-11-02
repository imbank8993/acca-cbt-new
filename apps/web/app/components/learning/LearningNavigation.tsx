'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { LearningMaterial } from '@/lib/learning-api';
import { loadLearningList, prefetchLearningDetail } from '@/lib/learning-reader-cache';
import { compareSubchapters, learningGradeLabel, learningKey } from '@/lib/learning-catalog';


type Branch = { label: string; children: Map<string, Branch>; materials: LearningMaterial[] };
function group(items: LearningMaterial[]) {
    const root: Branch = { label: '', children: new Map(), materials: [] };
    for (const item of items) {
        let node = root;
        for (const label of [learningGradeLabel(item.grade_level), item.subject?.trim() || 'Umum', item.topic?.trim() || 'Belum dikelompokkan']) {
            const key = learningKey(label);
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
/** Navigasi berhenti di subbab; bagian di dalam berkas bahan ajar tidak dicantumkan. */
/** Klik biasa ditangani di halaman (tanpa muat ulang); Ctrl/Cmd/Shift/klik tengah tetap membuka tab seperti tautan biasa. */
function plainClick(event: MouseEvent<HTMLAnchorElement>) {
    return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
function Branches({ node, currentId, navigate, select, depth = 0 }: { depth?: number; node: Branch; currentId: string; navigate: () => void; select?: (id: string) => void }) {
    return <ul className={`learn-nav-level learn-nav-level-${depth}`}>{Array.from(node.children.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label, 'id')).map(([key, child]) => <li key={key}>
        <details open={contains(child, currentId)}><summary><ChevronRight className="learn-nav-chevron" size={12} strokeWidth={2} aria-hidden="true" /><span>{child.label}</span></summary><Branches depth={depth + 1} node={child} currentId={currentId} navigate={navigate} select={select} /></details>
    </li>)}{[...node.materials].sort(compareSubchapters).map((item, index) => <li key={item.id}>
        <Link href={`/dashboard/learning/${item.id}`} aria-current={item.id === currentId ? 'page' : undefined} prefetch={false}
            onMouseEnter={() => prefetchLearningDetail(item.id)} onFocus={() => prefetchLearningDetail(item.id)} onTouchStart={() => prefetchLearningDetail(item.id)}
            onClick={event => { if (select && plainClick(event)) { event.preventDefault(); select(item.id); } navigate(); }}>{item.subtopic_order || index + 1}. {item.subtopic || item.title}<small>{item.status === 'draft' ? 'Draf' : 'Subbab'}{item.completed ? ' · Selesai' : ''}</small></Link>
    </li>)}</ul>;
}
export function LearningNavigation({ current, open, close, navigate, select }: { current: LearningMaterial | null; open: boolean; close: () => void; navigate: () => void; select?: (id: string) => void }) {
    const [items, setItems] = useState<LearningMaterial[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true); setError('');
        try { const materials = await loadLearningList(); if (!signal?.aborted) setItems(materials); }
        catch { if (!signal?.aborted) setError('Daftar bahan ajar belum dapat dimuat.'); }
        finally { if (!signal?.aborted) setLoading(false); }
    }, []);
    useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
    const all = current ? [...items.filter(item => item.id !== current.id), { ...items.find(item => item.id === current.id), ...current }] : items;
    // Ambil lebih dulu subbab sebelum/sesudahnya dalam BAB yang sama agar perpindahan terasa instan.
    useEffect(() => {
        if (!current || !items.length) return;
        const siblings = items.filter(item => (item.grade_level || '') === (current.grade_level || '') && learningKey(item.subject) === learningKey(current.subject) && learningKey(item.topic) === learningKey(current.topic)).sort(compareSubchapters);
        const index = siblings.findIndex(item => item.id === current.id);
        if (index < 0) return;
        const timer = window.setTimeout(() => [siblings[index + 1], siblings[index - 1]].forEach(item => item && prefetchLearningDetail(item.id)), 300);
        return () => window.clearTimeout(timer);
    }, [current, items]);
    return <aside id="learning-navigation" className="learn-navigation" hidden={!open}>
        <header><h2>BAB & subbab</h2><button aria-label="Tutup navigasi bahan ajar" onClick={close}><X size={18} /></button></header>
        {loading && <p role="status">Memuat daftar…</p>}
        {error && <div role="alert"><p>{error}</p><button onClick={() => void load()}>Coba lagi</button></div>}
        {(!!current || (!loading && !error)) && <nav aria-label="Mata pelajaran, materi, dan submateri"><Branches node={group(all)} currentId={current?.id || ''} navigate={navigate} select={select} />{!all.length && <p>Belum ada bahan ajar.</p>}</nav>}
    </aside>;
}
