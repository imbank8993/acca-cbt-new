'use client';

import { useEffect, useId, useState } from 'react';
import { listCommitteeTeachers, type PASCommitteeTeacher } from '@/lib/api/pas';

export function CommitteeChairNameInput({ value, nip, onChange, required = false, className }: {
    value: string;
    nip: string;
    onChange: (name: string, nip: string) => void;
    required?: boolean;
    className?: string;
}) {
    const listId = useId();
    const [teachers, setTeachers] = useState<PASCommitteeTeacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    useEffect(() => {
        let active = true;
        void listCommitteeTeachers().then(staff => {
            if (active) setTeachers(staff.sort((a, b) => a.name.localeCompare(b.name, 'id')));
        }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const selected = teachers.find(person => person.name === value && (person.nip || '') === nip);
    return <div className="space-y-2">
        <input type="text" required={required} value={value} className={className} list={listId}
            autoComplete="off" aria-describedby={`${listId}-hint`}
            aria-label="Nama lengkap dan gelar ketua panitia"
            placeholder="Cari guru atau ketik nama lengkap dan gelar"
            onChange={event => {
                const name = event.target.value;
                const teacher = teachers.find(person => person.name === name);
                onChange(name, teacher ? teacher.nip || '' : selected ? '' : nip);
            }} />
        <datalist id={listId}>
            {teachers.map(person => <option key={person.id} value={person.name} label={person.nip || undefined} />)}
        </datalist>
        <p id={`${listId}-hint`} className="text-xs text-slate-500">
            {loading ? 'Memuat pilihan guru. Nama tetap dapat diketik manual.'
                : loadError ? 'Master guru belum dapat dimuat. Nama dan NIP dapat diisi manual.'
                    : teachers.length === 0 ? 'Master guru belum tersedia. Nama dan NIP dapat diisi manual.'
                        : 'Ketik untuk mencari guru atau isi nama manual. Memilih guru akan mengisi NIP otomatis.'}
        </p>
    </div>;
}
