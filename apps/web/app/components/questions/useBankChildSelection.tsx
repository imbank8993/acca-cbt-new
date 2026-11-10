"use client";

import { alertDialog, deleteConfirmDialog } from '@/lib/confirm-dialog';
import { deleteBankChildItems } from '@/lib/bulk-bank-child-delete';
import { getErrorMessage } from '@/lib/errors';
import { CheckSquare, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';

type BankItem = { id: string };
type DeleteResult = { success: boolean; error?: string };

export function useBankChildSelection<T extends BankItem>({
    bankId, items, label, consequence, remove, reload,
}: {
    bankId: string;
    items: T[];
    label: string;
    consequence: string;
    remove: (id: string) => Promise<DeleteResult>;
    reload: () => Promise<void>;
}) {
    const [selectionState, setSelectionState] = useState<{ bankId: string; ids: Set<string> }>({ bankId, ids: new Set() });
    const [isDeleting, setIsDeleting] = useState(false);
    const itemIds = new Set(items.map(item => item.id));
    const selectedIds = new Set(
        selectionState.bankId === bankId ? [...selectionState.ids].filter(id => itemIds.has(id)) : [],
    );

    const updateSelection = (change: (ids: Set<string>) => void) => {
        setSelectionState(previous => {
            const ids = new Set(previous.bankId === bankId ? [...previous.ids].filter(id => itemIds.has(id)) : []);
            change(ids);
            return { bankId, ids };
        });
    };

    const toggle = (id: string) => {
        if (isDeleting) return;
        updateSelection(ids => {
            if (ids.has(id)) ids.delete(id);
            else ids.add(id);
        });
    };

    const toggleVisible = (visibleIds: string[]) => {
        if (isDeleting || visibleIds.length === 0) return;
        updateSelection(ids => {
            const allSelected = visibleIds.every(id => ids.has(id));
            visibleIds.forEach(id => { if (allSelected) ids.delete(id); else ids.add(id); });
        });
    };

    const deleteSelected = async () => {
        if (isDeleting) return;
        const ids = items.filter(item => selectedIds.has(item.id)).map(item => item.id);
        if (ids.length === 0) return;
        const confirmed = await deleteConfirmDialog({
            title: `Hapus ${ids.length} ${label}?`,
            text: `Item yang dipilih akan dihapus. ${consequence}`,
            confirmText: `Ya, Hapus ${ids.length}`,
        });
        if (!confirmed) return;

        setIsDeleting(true);
        try {
            const { failedIds, firstError } = await deleteBankChildItems(ids, remove);
            await reload();
            setSelectionState({ bankId, ids: new Set(failedIds) });
            if (failedIds.length > 0) {
                await alertDialog({
                    title: `${failedIds.length} ${label} gagal dihapus`,
                    text: `${ids.length - failedIds.length} berhasil dihapus. ${firstError}`,
                    variant: 'danger',
                });
            }
        } catch (error) {
            await alertDialog({ title: 'Daftar gagal dimuat ulang', text: getErrorMessage(error), variant: 'danger' });
        } finally {
            setIsDeleting(false);
        }
    };

    return { selectedIds, isDeleting, toggle, toggleVisible, clear: () => setSelectionState({ bankId, ids: new Set() }), deleteSelected };
}

export function BankChildSelectionBar({
    label, visibleIds, selectedIds, isDeleting, onToggleVisible, onClear, onDelete,
}: {
    label: string;
    visibleIds: string[];
    selectedIds: Set<string>;
    isDeleting: boolean;
    onToggleVisible: (ids: string[]) => void;
    onClear: () => void;
    onDelete: () => void;
}) {
    if (visibleIds.length === 0 && selectedIds.size === 0) return null;
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    return <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" role="group" aria-label={`Aksi ${label} terpilih`}>
        <button type="button" onClick={() => onToggleVisible(visibleIds)} disabled={isDeleting || visibleIds.length === 0}
            aria-pressed={allVisibleSelected}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
            {allVisibleSelected ? 'Batalkan pilihan yang tampil' : 'Pilih semua yang tampil'}
        </button>
        {selectedIds.size > 0 && <>
            <span className="text-xs font-semibold text-slate-600">{selectedIds.size} dipilih</span>
            <button type="button" onClick={onClear} disabled={isDeleting} className="px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50">Kosongkan</button>
            <button type="button" onClick={onDelete} disabled={isDeleting}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                <Trash2 size={15} />{isDeleting ? 'Menghapus...' : `Hapus (${selectedIds.size})`}
            </button>
        </>}
    </div>;
}
