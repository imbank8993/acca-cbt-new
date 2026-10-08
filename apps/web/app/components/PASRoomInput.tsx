"use client";

import { useEffect, useId, useState } from 'react';
import { listMasterRooms, type MasterRoom } from '@/lib/api/pas';

/** Master selection copies a suggestion; manual names remain fully supported. */
export function PASRoomInput({ value, onChange, onCapacityChange }: {
    value: string;
    onChange: (name: string) => void;
    onCapacityChange?: (capacity: number) => void;
}) {
    const id = useId();
    const [rooms, setRooms] = useState<MasterRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [selectedId, setSelectedId] = useState('');
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
    }, []);
    const fieldClass = 'w-full h-[40px] px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-primary';
    return <div className="space-y-2">
        <select aria-label="Pilih ruang dari master ACCA-new" className={fieldClass}
            disabled={loading || error || !rooms.length}
            value={rooms.find(room => room.id === selectedId)?.name === value ? selectedId : ''}
            onChange={event => {
                const room = rooms.find(item => item.id === event.target.value);
                setSelectedId(event.target.value);
                if (!room) return;
                onChange(room.name);
                if (room.capacity && room.capacity > 0) onCapacityChange?.(room.capacity);
            }}>
            <option value="">{loading ? 'Memuat master ruang…' : 'Pilih dari master ruang (opsional)'}</option>
            {rooms.map(room => <option key={room.id} value={room.id}>
                {[room.name, room.code, room.location].filter(Boolean).join(' • ')}
            </option>)}
        </select>
        <input id={id} aria-label="Nama ruang, dapat ditulis manual" type="text" value={value}
            onChange={event => { setSelectedId(''); onChange(event.target.value); }}
            placeholder="Atau ketik nama ruang manual" className={fieldClass} />
        <p className="text-xs text-slate-500" role={error ? 'status' : undefined}>
            {error ? 'Master ruang belum dapat dimuat. Silakan isi manual.'
                : !loading && !rooms.length ? 'Belum ada ruang aktif di master. Silakan isi manual.'
                    : 'Pilih dari master ACCA-new atau tulis nama ruang sendiri.'}
        </p>
    </div>;
}
