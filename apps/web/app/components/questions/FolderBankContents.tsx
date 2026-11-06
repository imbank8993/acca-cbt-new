'use client';

import type { QuestionBank } from '@/lib/api/questions';
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
        <div className="bank-folder-contents pl-6 space-y-2">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-2 rounded-lg border border-[#3083FF]/20 bg-white p-3">
                <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Cari bank soal</span>
                    <input
                        type="search"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder={`Cari di ${folderName}...`}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
                    />
                </label>
                <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Mata pelajaran</span>
                    <select
                        value={selectedSubject}
                        onChange={event => setSubject(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
                    >
                        <option value="">Semua Mapel</option>
                        {subjects.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
                <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Kelas</span>
                    <select
                        value={selectedClassLevel}
                        onChange={event => setClassLevel(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
                    >
                        <option value="">Semua Kelas</option>
                        {classLevels.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
            </div>
            {visibleBanks.length > 0 ? visibleBanks.map(renderBank) : (
                <p role="status" className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
                    Tidak ada bank soal yang cocok di folder ini.
                </p>
            )}
        </div>
    );
}
