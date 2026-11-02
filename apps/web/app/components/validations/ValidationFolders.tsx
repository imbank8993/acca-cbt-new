"use client";

import { useState, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderPlus, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { confirmDialog } from '@/lib/confirm-dialog';
import { createValidationFolder, updateValidationFolder, deleteValidationFolder, type ValidationFolder } from '@/lib/api/validations';
import './validation-folders.css';

interface Props<T extends { folder_id?: string | null }> {
    folders: ValidationFolder[];
    items: T[];
    renderItems: (items: T[]) => ReactNode;
    empty: ReactNode;
    filterActive?: boolean;
    createOpen?: boolean;
    onCloseCreate?: () => void;
    onCreateValidation?: (folderId: string) => void;
    onCreated?: () => void;
    onRefresh?: () => Promise<void>;
}

export function ValidationFolders<T extends { folder_id?: string | null }>({ folders, items, renderItems, empty, filterActive = false, createOpen = false, onCloseCreate, onCreateValidation, onCreated, onRefresh }: Props<T>) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<ValidationFolder | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const open = createOpen || !!editing;
    const groups = new Map<string, T[]>();
    for (const folder of folders) groups.set(folder.id, []);
    const unfiled: T[] = [];
    for (const item of items) {
        const group = item.folder_id ? groups.get(item.folder_id) : undefined;
        if (group) group.push(item);
        else unfiled.push(item);
    }
    const visibleFolders = folders.filter(folder => !filterActive || groups.get(folder.id)?.length);
    const close = () => {
        if (saving) return;
        setEditing(null);
        setName('');
        setError(null);
        onCloseCreate?.();
    };

    const edit = (folder: ValidationFolder | null) => {
        setEditing(folder);
        setName(folder?.name || '');
        setError(null);
    };
    const save = async () => {
        if (!name.trim() || !onRefresh) return;
        setSaving(true);
        setError(null);
        try {
            const result = editing ? await updateValidationFolder(editing.id, name.trim()) : await createValidationFolder(name.trim());
            if (!result.success) throw new Error(result.error || 'Folder gagal disimpan.');
            await onRefresh();
            const id = editing?.id || result.id;
            if (!editing) onCreated?.();
            setExpanded(previous => new Set([...previous, id]));
            setEditing(null);
            setName('');
            onCloseCreate?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Folder gagal disimpan.');
        } finally { setSaving(false); }
    };
    const remove = async (folder: ValidationFolder) => {
        if (!onRefresh || folder.canDelete !== true) return;
        if (!await confirmDialog({ title: 'Hapus folder kosong?', text: `Folder “${folder.name}” akan dihapus.`, confirmText: 'Hapus Folder', cancelText: 'Batal', variant: 'danger' })) return;
        setSaving(true);
        setError(null);
        try {
            const result = await deleteValidationFolder(folder.id);
            if (!result.success) throw new Error(result.error || 'Folder gagal dihapus.');
            await onRefresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Folder gagal dihapus.');
        } finally { setSaving(false); }
    };

    return <section className="validation-folders" aria-label="Folder validasi">
        {error && !open && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {visibleFolders.map(folder => {
            const contents = groups.get(folder.id) || [];
            const isExpanded = expanded.has(folder.id);
            return <div key={folder.id} className="validation-folder-group">
                <div className="validation-folder">
                    <button type="button" className="validation-folder__open" aria-label={`Buka folder ${folder.name}`} aria-expanded={isExpanded} aria-controls={`validation-folder-content-${folder.id}`}
                        onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}>
                        <ChevronRight size={16} className={isExpanded ? 'validation-folder__chevron--open' : ''} />
                        <Folder size={18} /><strong>{folder.name}</strong><small>({contents.length})</small>
                    </button>
                    <div className="validation-folder__actions">
                        {onCreateValidation && <button type="button" onClick={() => onCreateValidation(folder.id)} disabled={saving} aria-label={`Tambah validasi ke ${folder.name}`} title="Tambah validasi ke folder"><Plus size={15} /></button>}
                        {onRefresh && folder.canManage && <>
                            <button type="button" onClick={() => edit(folder)} disabled={saving} aria-label={`Ubah folder ${folder.name}`} title="Ubah nama folder"><Pencil size={14} /></button>
                            <button type="button" onClick={() => remove(folder)} disabled={saving || folder.canDelete !== true} aria-label={`Hapus folder ${folder.name}`} title={folder.canDelete ? 'Hapus folder kosong' : 'Pindahkan seluruh sesi keluar sebelum menghapus folder'}><Trash2 size={14} /></button>
                        </>}
                    </div>
                </div>
                {isExpanded && <div id={`validation-folder-content-${folder.id}`} className="validation-folder__contents">
                    {contents.length ? renderItems(contents) : <p className="validation-folder__empty">{filterActive ? 'Tidak ada validasi yang sesuai dengan pencarian.' : 'Folder ini belum berisi sesi validasi.'}</p>}
                </div>}
            </div>;
        })}
        {unfiled.length > 0 && renderItems(unfiled)}
        {!visibleFolders.length && !unfiled.length && empty}
        <Modal open={open} onClose={close} title={editing ? 'Ubah Folder Validasi' : 'Buat Folder Validasi'} icon={<FolderPlus size={20} />} size="sm">
            <ModalBody>
                <label htmlFor="validation-folder-name" className="block text-sm font-semibold mb-2">Nama folder</label>
                <input id="validation-folder-name" className="validation-folder-input" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Contoh: ASAS 2026" disabled={saving} autoFocus />
                {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            </ModalBody>
            <ModalFooter><Button variant="outline" onClick={close} disabled={saving}>Batal</Button><Button onClick={save} disabled={saving || !name.trim()}>{saving ? 'Menyimpan...' : 'Simpan Folder'}</Button></ModalFooter>
        </Modal>
    </section>;
}
