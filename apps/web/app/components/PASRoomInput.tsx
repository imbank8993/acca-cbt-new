"use client";

import { useEffect, useId, useState } from 'react';
import { listMasterRooms, type MasterRoom } from '@/lib/api/pas';

/** One field supports both master-room suggestions and a custom room name. */
export function PASRoomInput({ value, onChange, onCapacityChange, existingRooms = [] }: {
    value: string;
    onChange: (name: string) => void;
    onCapacityChange?: (capacity: number) => void;
    existingRooms?: Array<{ id: string; name: string; capacity?: number }>;
}) {
    const id = useId();
    const [rooms, setRooms] = useState<MasterRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);

    useEffect(() => {
        let cancelled = false;
        listMasterRooms().then(data => {
            if (!cancelled) setRooms(data);
        }).catch(() => {
            if (!cancelled) setError(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [retry]);

    const suggestions = [...existingRooms, ...rooms].filter((room, index, all) =>
        all.findIndex(candidate => candidate.name.trim().toLowerCase() === room.name.trim().toLowerCase()) === index,
    );
    const query = value.trim().toLowerCase();
    const filtered = suggestions.filter(room => !query ||
        [room.name, 'code' in room ? room.code : '', 'location' in room ? room.location : '']
            .some(text => text?.toLowerCase().includes(query)));
    const select = (room: (typeof suggestions)[number]) => {
        onChange(room.name);
        if (room.capacity && room.capacity > 0) onCapacityChange?.(room.capacity);
        setOpen(false); setActive(-1);
    };

    return <div className="relative space-y-1.5" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
        <input
            aria-label="Nama ruang, dapat ditulis manual"
            aria-busy={loading}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={id}
            aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
            type="text"
            autoComplete="off"
            value={value}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={event => {
                if (event.key === 'Escape' && open) {
                    event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); setOpen(true);
                    setActive(previous => !filtered.length ? -1 : previous < 0
                        ? event.key === 'ArrowDown' ? 0 : filtered.length - 1
                        : (previous + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
                }
                if (event.key === 'Enter' && open && active >= 0 && filtered[active]) {
                    event.preventDefault(); select(filtered[active]);
                }
            }}
            onChange={event => {
                const name = event.target.value;
                onChange(name);
                setOpen(true); setActive(-1);
                const room = suggestions.find(item => item.name.trim().toLowerCase() === name.trim().toLowerCase());
                if (room?.capacity && room.capacity > 0) onCapacityChange?.(room.capacity);
            }}
            placeholder="Cari atau ketik nama ruang..."
            className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
        />
        {open && <div id={id} role="listbox" aria-label="Daftar ruang"
            className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-[var(--card)]">
            {filtered.map((room, index) => <button key={room.name} type="button" role="option" id={`${id}-${index}`}
                aria-selected={index === active}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(room)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 dark:text-slate-200 dark:hover:bg-slate-800 ${index === active ? 'bg-blue-50 dark:bg-slate-800' : ''}`}>
                <span>{room.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{room.capacity ? `${room.capacity} kursi` : ''}</span>
            </button>)}
            {!filtered.length && <p className="px-3 py-2 text-xs text-slate-500">{loading ? 'Memuat daftar ruang…' : 'Nama ruang boleh diketik bebas, tidak harus ada dalam daftar master.'}</p>}
        </div>}
        {loading && <p className="text-[11px] text-slate-500" role="status">Memuat daftar ruang…</p>}
        {error && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" role="status">
            <span>Daftar ruang belum dimuat. Nama tetap bisa diketik.</span>
            <button type="button" className="text-blue-600 underline" onClick={() => {
                setError(false); setLoading(true); setRetry(count => count + 1);
            }}>Coba lagi</button>
        </div>}
    </div>;
}
