"use client";

import { useEffect, useId, useState } from 'react';
import { listMasterRooms, type MasterRoom } from '@/lib/api/pas';
import { InlineSelect, type InlineSelectOption } from '@/app/components/ui/inlineselect';

/** Master selection copies a suggestion; manual names remain fully supported. */
export function PASRoomInput({
    value,
    onChange,
    onCapacityChange,
    existingRooms,
}: {
    value: string;
    onChange: (name: string) => void;
    onCapacityChange?: (capacity: number) => void;
    existingRooms?: Array<{ id: string; name: string; capacity?: number }>;
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

    // Build select options combining existing rooms and master rooms
    const selectOptions: InlineSelectOption[] = [
        {
            value: '',
            label: loading
                ? 'Memuat master ruang…'
                : existingRooms && existingRooms.length > 0
                    ? '— Pilih dari Ruang Periode / Master —'
                    : '— Pilih dari Master Ruang (Opsional) —',
        },
    ];

    if (existingRooms && existingRooms.length > 0) {
        for (const er of existingRooms) {
            selectOptions.push({
                value: `period:${er.id}`,
                label: `[Ruang Periode] ${er.name}${er.capacity ? ` (${er.capacity} Kursi)` : ''}`,
            });
        }
    }

    if (rooms.length > 0) {
        for (const mr of rooms) {
            // Avoid duplicate if same name already in period rooms
            const alreadyInPeriod = existingRooms?.some(er => er.name.toLowerCase() === mr.name.toLowerCase());
            if (!alreadyInPeriod) {
                const labelDetails = [mr.name, mr.code, mr.location].filter(Boolean).join(' • ');
                selectOptions.push({
                    value: `master:${mr.id}`,
                    label: `[Master] ${labelDetails}${mr.capacity ? ` (${mr.capacity} Kursi)` : ''}`,
                });
            }
        }
    }

    // Determine current value in dropdown
    const currentValue = (() => {
        if (!value) return '';
        if (selectedId) return selectedId;
        const periodMatch = existingRooms?.find(r => r.name.toLowerCase() === value.toLowerCase());
        if (periodMatch) return `period:${periodMatch.id}`;
        const masterMatch = rooms.find(r => r.name.toLowerCase() === value.toLowerCase());
        if (masterMatch) return `master:${masterMatch.id}`;
        return '';
    })();

    const handleSelectChange = (val: string) => {
        setSelectedId(val);
        if (!val) {
            return;
        }

        if (val.startsWith('period:')) {
            const periodRoomId = val.replace('period:', '');
            const found = existingRooms?.find(r => r.id === periodRoomId);
            if (found) {
                onChange(found.name);
                if (found.capacity && found.capacity > 0) onCapacityChange?.(found.capacity);
            }
        } else if (val.startsWith('master:')) {
            const masterRoomId = val.replace('master:', '');
            const found = rooms.find(r => r.id === masterRoomId);
            if (found) {
                onChange(found.name);
                if (found.capacity && found.capacity > 0) onCapacityChange?.(found.capacity);
            }
        }
    };

    const fieldClass = 'w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 transition-all';

    return (
        <div className="space-y-2">
            <InlineSelect
                value={currentValue}
                onChange={handleSelectChange}
                options={selectOptions}
                disabled={loading || (error && (!existingRooms || existingRooms.length === 0))}
                minWidth="100%"
                height="40px"
                title="Pilih Ruang Ujian"
            />
            <input
                id={id}
                aria-label="Nama ruang, dapat ditulis manual"
                type="text"
                value={value}
                onChange={event => {
                    setSelectedId('');
                    onChange(event.target.value);
                }}
                placeholder="Atau ketik nama ruang manual (misal: R. 01, Lab Komputer)"
                className={fieldClass}
            />
            <p className="text-[11px] text-slate-500" role={error ? 'status' : undefined}>
                {error && (!existingRooms || existingRooms.length === 0)
                    ? 'Master ruang belum dapat dimuat. Silakan ketik nama ruang manual.'
                    : 'Pilih dari daftar ruang yang tersedia atau ketik nama ruang sendiri.'}
            </p>
        </div>
    );
}
