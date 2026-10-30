'use client';

import { useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { SearchableSelect } from '@/app/components/ui/SearchableSelect';
import { Modal, ModalBody, ModalField, ModalFooter } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import { normalizeQuestionGroup, type QuestionGroupOption } from '@/lib/question-groups';

export function QuestionGroupPicker({ value, groups, onChange }: {
    value: string; groups: QuestionGroupOption[]; onChange: (name: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [draftGroups, setDraftGroups] = useState<string[]>([]);
    const choices = [...groups];
    for (const name of [...draftGroups, value]) {
        if (name.trim() && !choices.some(group => normalizeQuestionGroup(group.name) === normalizeQuestionGroup(name))) {
            choices.push({ name: name.trim(), count: 0 });
        }
    }
    const selected = choices.find(group => normalizeQuestionGroup(group.name) === normalizeQuestionGroup(value));
    const duplicate = choices.find(group => normalizeQuestionGroup(group.name) === normalizeQuestionGroup(newName));

    return <div className="space-y-2">
        <SearchableSelect value={selected?.name || ''} onChange={name => onChange(String(name || ''))}
            options={[{ value: '', label: 'Tanpa grup manual' }, ...choices.map(group => ({
                value: group.name, label: group.name, subLabel: group.count ? `${group.count} soal` : 'Grup baru',
            }))]} placeholder="Pilih grup soal" searchPlaceholder="Cari grup yang sudah ada..." />
        <button type="button" onClick={() => { setNewName(''); setAdding(true); }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            <Plus size={13} /> Tambah Grup Baru
        </button>
        <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            Pilih nama yang sama agar soal tetap berdampingan saat diacak. Tanpa grup manual, soal mengikuti kelompok stimulusnya.
        </p>
        <Modal open={adding} onClose={() => setAdding(false)} size="sm" title="Tambah Grup Soal" icon={<Layers size={18} />}>
            <form onSubmit={event => {
                event.preventDefault();
                const name = newName.trim();
                if (!name) return;
                const chosen = duplicate?.name || name;
                if (!duplicate) setDraftGroups(current => [...current, chosen]);
                onChange(chosen);
                setAdding(false);
            }}>
                <ModalBody>
                    <ModalField label="Nama grup">
                        <input autoFocus value={newName} maxLength={50} placeholder="Contoh: Bacaan 1"
                            onChange={event => setNewName(event.target.value)} />
                    </ModalField>
                    {duplicate && <p className="text-xs text-blue-600 dark:text-blue-400">Grup “{duplicate.name}” sudah ada. Nama yang sama akan digunakan.</p>}
                    <p className="text-xs text-slate-500">Grup diterapkan setelah soal disimpan.</p>
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="cancel" onClick={() => setAdding(false)}>Batal</Button>
                    <Button type="submit" variant="primary" disabled={!newName.trim()}>{duplicate ? 'Gunakan Grup' : 'Tambah Grup'}</Button>
                </ModalFooter>
            </form>
        </Modal>
    </div>;
}
