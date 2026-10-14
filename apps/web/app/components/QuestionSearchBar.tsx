'use client';
import { Search, X } from 'lucide-react';

export function QuestionSearchBar({ value, onChange, matched, total }: {
    value: string; onChange: (value: string) => void; matched: number; total: number;
}) {
    return <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative flex-1 min-w-0">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="search" value={value} onChange={event => onChange(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') onChange(''); }}
                aria-label="Cari soal berdasarkan nomor atau teks" placeholder="Cari nomor atau teks soal…"
                style={{ paddingLeft: 40, paddingRight: 40 }}
                className="w-full h-11 rounded-lg border border-slate-200 bg-slate-50 text-sm outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15 [&::-webkit-search-cancel-button]:appearance-none" />
            {value && <button type="button" aria-label="Hapus pencarian soal" onClick={() => onChange('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-400 hover:text-[#3083FF] hover:bg-blue-50"><X size={16} /></button>}
        </div>
        <span role="status" className="text-xs text-slate-500 shrink-0 tabular-nums">{matched} dari {total} soal</span>
    </div>;
}
