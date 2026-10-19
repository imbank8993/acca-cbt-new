'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Monitor, Trash2 } from 'lucide-react';

export function PASScheduleActions({ active, canActivate, busy, monitoringHref, canDelete, onActivate, onDelete, compact = false }: {
    active?: boolean | null; canActivate: boolean; busy: boolean; monitoringHref?: string;
    canDelete: boolean; onActivate: () => void; onDelete: () => void;
    compact?: boolean;
}) {
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!position) return;
        menu.current?.querySelector<HTMLElement>('a, button:not(:disabled)')?.focus();
        const outside = (event: PointerEvent) => {
            if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
        };
        const close = () => setPosition(null);
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); setPosition(null); trigger.current?.focus(); }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', escape);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [position]);
    return <div className="pas-schedule-actions">
        {!compact && <button type="button" disabled={busy || (active !== true && !canActivate)} onClick={onActivate}
            title={active === true ? 'Nonaktifkan ujian' : canActivate ? 'Aktifkan ujian' : 'Lengkapi kebutuhan ujian terlebih dahulu'}
            className={`pas-schedule-activation ${active === true ? 'is-active' : ''}`}>
            {busy ? 'Memproses…' : active === true ? 'Nonaktifkan' : 'Aktifkan'}
        </button>}
        {(compact || monitoringHref || canDelete) && <button ref={trigger} type="button" disabled={busy} aria-label="Aksi lainnya"
            aria-haspopup="menu" aria-expanded={Boolean(position)} className="pas-schedule-more"
            onClick={() => {
                if (position) { setPosition(null); return; }
                const rect = trigger.current!.getBoundingClientRect();
                const menuHeight = compact ? (1 + Number(Boolean(monitoringHref)) + Number(canDelete)) * 40 + 12 : 112;
                setPosition({ left: Math.max(8, Math.min(window.innerWidth - 200, rect.right - 192)),
                    top: rect.bottom + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight) : rect.bottom + 6 });
            }}><MoreHorizontal size={18} /></button>}
        {position && createPortal(<div ref={menu} role="menu" aria-label="Aksi jadwal" className="pas-schedule-menu" style={{ left: position.left, top: position.top }}
            onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPosition(null); }}
            onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
                if (!items.length) return;
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }}>
            {compact && <button type="button" role="menuitem" disabled={busy || (active !== true && !canActivate)}
                title={active === true ? 'Nonaktifkan ujian' : canActivate ? 'Aktifkan ujian' : 'Lengkapi kebutuhan ujian terlebih dahulu'}
                onClick={() => { setPosition(null); trigger.current?.focus(); onActivate(); }}>{active === true ? 'Nonaktifkan' : 'Aktifkan'}</button>}
            {monitoringHref && <a role="menuitem" href={monitoringHref} onClick={() => setPosition(null)}><Monitor size={15} />Monitoring</a>}
            {canDelete && <button type="button" role="menuitem" className="is-danger" onClick={() => { setPosition(null); trigger.current?.focus(); onDelete(); }}><Trash2 size={15} />Hapus jadwal</button>}
        </div>, document.body)}
    </div>;
}
