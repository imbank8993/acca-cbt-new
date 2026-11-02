'use client';

import { ChevronDown } from 'lucide-react';

/** Jumlah item per halaman pada daftar bank soal dan daftar ujian. */
export const LIST_PAGE_SIZE = 20;

/**
 * Pagination daftar dengan tampilan yang sama seperti halaman bank soal.
 * Tidak tampil bila seluruh item muat dalam satu halaman.
 */
export function ListPagination({ page, totalItems, pageSize = LIST_PAGE_SIZE, onPageChange }: {
    page: number;
    totalItems: number;
    pageSize?: number;
    onPageChange: (page: number) => void;
}) {
    if (totalItems <= pageSize) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    return (
        <div className="flex items-center justify-between pt-3">
            <p className="text-xs text-slate-400">
                Menampilkan {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalItems)} dari {totalItems}
            </p>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    aria-label="Halaman sebelumnya"
                    onClick={() => onPageChange(Math.max(1, safePage - 1))}
                    disabled={safePage === 1}
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronDown size={14} className="rotate-90" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(item => (
                    <button
                        type="button"
                        key={item}
                        aria-current={safePage === item ? 'page' : undefined}
                        onClick={() => onPageChange(item)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${safePage === item ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {item}
                    </button>
                ))}
                <button
                    type="button"
                    aria-label="Halaman berikutnya"
                    onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                    disabled={safePage === totalPages}
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronDown size={14} className="-rotate-90" />
                </button>
            </div>
        </div>
    );
}
