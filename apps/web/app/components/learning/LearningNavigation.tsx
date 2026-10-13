'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';

import type { HtmlMenuItem } from '@/lib/learning-navigation-bridge';
type MenuProps = { htmlMenu?: HtmlMenuItem[]; selectMenu?: (id: string) => void };

type Branch = { label: string; children: Map<string, Branch>; materials: LearningMaterial[] };
function group(items: LearningMaterial[]) {
    const root: Branch = { label: '', children: new Map(), materials: [] };
    for (const item of items) {
        let node = root;
        for (const label of [item.subject?.trim() || 'Mata pelajaran umum', item.topic?.trim() || 'Materi umum', item.subtopic?.trim()].filter((label): label is string => !!label)) {
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
function Branches({ node, currentId, navigate, htmlMenu, selectMenu, depth = 0 }: MenuProps & { depth?: number; node: Branch; currentId: string; navigate: () => void }) {
    return <ul className={`learn-nav-level learn-nav-level-${depth}`}>{Array.from(node.children.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label, 'id')).map(([key, child]) => <li key={key}>
        <details open={contains(child, currentId)}><summary><ChevronRight className="learn-nav-chevron" size={12} strokeWidth={2} aria-hidden="true" /><span>{child.label}</span></summary><Branches depth={depth + 1} node={child} currentId={currentId} navigate={navigate} htmlMenu={htmlMenu} selectMenu={selectMenu} /></details>
    </li>)}{[...node.materials].sort((a, b) => a.title.localeCompare(b.title, 'id')).map(item => <li key={item.id}>
        <Link href={`/dashboard/learning/${item.id}`} aria-current={item.id === currentId ? 'page' : undefined} onClick={navigate}>{item.title}<small>{item.grade_level ? `Kelas ${item.grade_level}` : 'Lintas kelas'}{item.status === 'draft' ? ' · Draf' : ''}</small></Link>
        {item.id === currentId && !!htmlMenu?.length && <ul className="learn-html-menu-list" aria-label="Submateri dalam HTML">{htmlMenu.map((menu, index) => <li key={menu.id}>{menu.group && menu.group !== htmlMenu[index - 1]?.group && <div className="learn-html-menu-heading">{menu.group}</div>}<button className="learn-html-menu" aria-current={menu.active ? 'location' : undefined} onClick={() => { selectMenu?.(menu.id); navigate(); }}>{menu.label}</button></li>)}</ul>}
    </li>)}</ul>;
}
export function LearningNavigation({ current, open, close, navigate, htmlMenu, selectMenu }: MenuProps & { current: LearningMaterial | null; open: boolean; close: () => void; navigate: () => void }) {
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
        {(!!current || (!loading && !error)) && <nav aria-label="Mata pelajaran, materi, dan submateri"><Branches key={current?.id} node={group(all)} currentId={current?.id || ''} navigate={navigate} htmlMenu={htmlMenu} selectMenu={selectMenu} />{!all.length && <p>Belum ada bahan ajar.</p>}</nav>}
    </aside>;
}
