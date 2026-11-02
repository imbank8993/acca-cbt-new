"use client";

import { useState } from 'react';
import { Folder, FolderPlus, Layers, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { confirmDialog } from '@/lib/confirm-dialog';
import { createValidationFolder, updateValidationFolder, deleteValidationFolder, type ValidationFolder } from '@/lib/api/validations';
import './validation-folders.css';

interface Props {
    folders: ValidationFolder[];
    folderIds: Array<string | null | undefined>;
    value: string;
    onChange: (id: string) => void;
    onRefresh?: () => Promise<void>;
}

export function ValidationFolders({ folders, folderIds, value, onChange, onRefresh }: Props) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<ValidationFolder | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const counts = new Map<string, number>();
    for (const id of folderIds) counts.set(id || 'none', (counts.get(id || 'none') || 0) + 1);

    const edit = (folder: ValidationFolder | null) => {
        setEditing(folder);
        setName(folder?.name || '');
        setError(null);
        setOpen(true);
    };
    const save = async () => {
        if (!name.trim() || !onRefresh) return;
        setSaving(true);
        setError(null);
        try {
            const result = editing ? await updateValidationFolder(editing.id, name.trim()) : await createValidationFolder(name.trim());
            if (!result.success) throw new Error(result.error || 'Folder gagal disimpan.');
            await onRefresh();
            onChange(editing?.id || result.id);
            setOpen(false);
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
            if (value === folder.id) onChange('all');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Folder gagal dihapus.');
        } finally { setSaving(false); }
    };

    return <section className="validation-folders" aria-label="Folder validasi">
        <div className="validation-folders__heading">
            <div><h2>Folder Validasi</h2><p>{onRefresh ? 'Kelompokkan penelaahan soal menurut kegiatan atau tahun ajaran.' : 'Pilih kelompok tugas validasi yang ditugaskan kepada Anda.'}</p></div>
            {onRefresh && <Button variant="outline" size="sm" onClick={() => edit(null)} disabled={saving}><FolderPlus size={15} /> Buat Folder</Button>}
        </div>
        {error && !open && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="validation-folders__grid">
            {[{ id: 'all', name: 'Semua Validasi' }, { id: 'none', name: 'Tanpa Folder' }, ...folders].map((folder: ValidationFolder) => (
                <div key={folder.id} className={`validation-folder ${value === folder.id ? 'validation-folder--active' : ''}`}>
                    <button type="button" className="validation-folder__open" aria-pressed={value === folder.id} onClick={() => onChange(folder.id)}>
                        {folder.id === 'all' ? <Layers size={19} /> : <Folder size={19} />}
                        <span><strong>{folder.name}</strong><small>{folder.id === 'all' ? folderIds.length : counts.get(folder.id) || 0} validasi</small></span>
                    </button>
                    {onRefresh && folder.canManage && <div className="validation-folder__actions">
                        <button type="button" onClick={() => edit(folder)} disabled={saving} aria-label={`Ubah folder ${folder.name}`} title="Ubah nama folder"><Pencil size={13} /></button>
                        <button type="button" onClick={() => remove(folder)} disabled={saving || folder.canDelete !== true} aria-label={`Hapus folder ${folder.name}`} title={folder.canDelete ? 'Hapus folder kosong' : 'Pindahkan seluruh sesi keluar sebelum menghapus folder'}><Trash2 size={13} /></button>
                    </div>}
                </div>
            ))}
        </div>
        <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title={editing ? 'Ubah Folder Validasi' : 'Buat Folder Validasi'} icon={<FolderPlus size={20} />} size="sm">
            <ModalBody>
                <label htmlFor="validation-folder-name" className="block text-sm font-semibold mb-2">Nama folder</label>
                <input id="validation-folder-name" className="validation-folder-input" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Contoh: ASAS 2026" disabled={saving} autoFocus />
                {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            </ModalBody>
            <ModalFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button><Button onClick={save} disabled={saving || !name.trim()}>{saving ? 'Menyimpan...' : 'Simpan Folder'}</Button></ModalFooter>
        </Modal>
    </section>;
}
