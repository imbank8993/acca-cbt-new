'use client';

import type { QuestionBank } from '@/lib/api/questions';
import { FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { useState, type ReactNode } from 'react';

interface FolderBankContentsProps {
    folderName: string;
    banks: QuestionBank[];
    renderBank: (bank: QuestionBank) => ReactNode;
}

export function FolderBankContents({ folderName, banks, renderBank }: FolderBankContentsProps) {
    const [search, setSearch] = useState('');
    const [subject, setSubject] = useState('');
    const [classLevel, setClassLevel] = useState('');

    const subjects = Array.from(new Set(banks.map(bank => bank.subject).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'id'));
    const classLevels = Array.from(new Set(banks.map(bank => bank.class_level || bank.classLevel).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'id'));
    const selectedSubject = subjects.includes(subject) ? subject : '';
    const selectedClassLevel = classLevels.includes(classLevel) ? classLevel : '';
    const query = search.trim().toLocaleLowerCase('id');
    const visibleBanks = banks.filter(bank =>
        bank.title.toLocaleLowerCase('id').includes(query) &&
        (!selectedSubject || bank.subject === selectedSubject) &&
        (!selectedClassLevel || (bank.class_level || bank.classLevel) === selectedClassLevel)
    );

    return (
        <div className="bank-folder-contents pl-6">
            <FilterToolbar className="ftb-toolbar--noSticky" alwaysExpanded>
                <FilterSearch label="Cari bank soal" value={search} onChange={setSearch} placeholder={`Cari di ${folderName}...`} grow={2} />
                <FilterSelect label="Mata pelajaran" value={selectedSubject} onChange={setSubject}
                    options={[{ value: '', label: 'Semua Mapel' }, ...subjects.map(value => ({ value, label: value }))]} />
                <FilterSelect label="Kelas" value={selectedClassLevel} onChange={setClassLevel}
                    options={[{ value: '', label: 'Semua Kelas' }, ...classLevels.map(value => ({ value, label: value }))]} />
            </FilterToolbar>
            <div className="mt-4 space-y-2">
                {visibleBanks.length > 0 ? visibleBanks.map(renderBank) : (
                    <p role="status" className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
                        Tidak ada bank soal yang cocok di folder ini.
                    </p>
                )}
            </div>
        </div>
    );
}
