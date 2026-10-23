'use client';

import { useEffect, useState } from 'react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { listTeachersAndInvigilators, type PASStaffMember } from '@/lib/api/pas';

export function CommitteeChairNameInput({ value, nip, onChange, required = false, className }: {
    value: string;
    nip: string;
    onChange: (name: string, nip: string) => void;
    required?: boolean;
    className?: string;
}) {
    const [teachers, setTeachers] = useState<PASStaffMember[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        void listTeachersAndInvigilators().then(staff => {
            if (active) setTeachers(staff.filter(person => person.roles.includes('Guru'))
                .sort((a, b) => a.name.localeCompare(b.name, 'id')));
        }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const selected = teachers.find(person => person.name === value && (person.nip || '') === nip);
    return <div className="space-y-2">
        <InlineSelect value={selected?.id || ''} minWidth="100%" className="w-full"
            aria-label="Pilih ketua panitia dari master guru" disabled={loading}
            options={[
                { value: '', label: loading ? 'Memuat master guru…' : 'Ketik manual / pilih guru' },
                ...teachers.map(person => ({ value: person.id, label: `${person.name}${person.nip ? ` · ${person.nip}` : ''}` })),
            ]}
            onChange={id => {
                const teacher = teachers.find(person => person.id === id);
                if (teacher) onChange(teacher.name, teacher.nip || '');
                else onChange('', '');
            }} />
        <input type="text" required={required} value={value} className={className}
            aria-label="Nama lengkap dan gelar ketua panitia"
            placeholder="Ketik nama lengkap dan gelar"
            onChange={event => onChange(event.target.value, selected ? '' : nip)} />
        {!loading && teachers.length === 0 && <p className="text-xs text-slate-500">Master guru belum tersedia. Nama dan NIP dapat diisi manual.</p>}
    </div>;
}
