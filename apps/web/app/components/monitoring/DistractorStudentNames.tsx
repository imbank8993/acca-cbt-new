'use client';

import { useId, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { FilterSearch, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { formatStudentName } from '@/lib/monitoring-health';

export function DistractorStudentNames({ names, optionLetter, questionNumber, isCorrect }: {
    names: string[];
    optionLetter: string;
    questionNumber?: number;
    isCorrect: boolean;
}) {
    const titleId = useId();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    if (names.length === 0) return null;

    const firstName = formatStudentName(names[0], 'Tanpa Nama');
    const query = search.trim().toLocaleLowerCase('id');
    const students = names.map(name => formatStudentName(name, 'Tanpa Nama'))
        .filter(name => name.toLocaleLowerCase('id').includes(query));

    return <div className="pt-2 border-t border-slate-100">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Siswa yang Memilih:
        </div>
        <div className="flex min-w-0 items-center gap-2">
            <span title={firstName} className={`min-w-0 max-w-full truncate text-[11px] px-2 py-0.5 rounded-md font-medium ${
                isCorrect ? 'bg-emerald-100/70 text-emerald-800' : 'bg-slate-100 text-slate-700'
            }`}>{firstName}</span>
            {names.length > 1 && <button type="button"
                className="shrink-0 min-h-11 sm:min-h-9 px-2 text-xs font-semibold text-[#3083FF] rounded-lg hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-haspopup="dialog" aria-expanded={open}
                aria-label={`Lihat ${names.length - 1} siswa lainnya yang memilih opsi ${optionLetter}`}
                onClick={() => { setSearch(''); setOpen(true); }}>
                +{names.length - 1} lainnya
            </button>}
        </div>
        <Modal open={open} onClose={() => setOpen(false)} size="md" labelledBy={titleId}
            title={`Daftar Siswa — Opsi ${optionLetter}`}
            subtitle={`${questionNumber ? `Soal No. ${questionNumber} · ` : ''}${names.length} siswa memilih opsi ini`}>
            <ModalBody className="space-y-4">
                <FilterToolbar alwaysExpanded className="!static">
                    <FilterSearch value={search} onChange={setSearch} label="Cari siswa" placeholder="Cari nama siswa…" />
                </FilterToolbar>
                <p role="status" className="text-xs text-slate-500">{students.length} dari {names.length} siswa</p>
                {students.length ? <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                    {students.map((name, index) => <li key={index} className="flex gap-3 px-4 py-3 text-sm">
                        <span aria-hidden="true" className="w-6 shrink-0 text-slate-400 tabular-nums">{index + 1}.</span>
                        <span className="min-w-0 break-words font-medium text-slate-700">{name}</span>
                    </li>)}
                </ol> : <p className="py-6 text-center text-sm text-slate-500">Tidak ada siswa yang cocok dengan pencarian.</p>}
            </ModalBody>
            <ModalFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Tutup daftar</Button>
            </ModalFooter>
        </Modal>
    </div>;
}
