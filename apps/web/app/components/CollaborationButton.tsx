'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRoundCog } from 'lucide-react';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { apiGet, apiSend } from '@/lib/api/client';

interface Collaborator {
    user_id: string; name: string; permission: 'viewer' | 'editor' | 'manager';
    can_reset?: boolean; expires_at?: string | null; revoked_at?: string | null;
}
interface CollaborationData { ownerId: string; ownerName: string; canShare: boolean; canGrantPrivileged: boolean; activeCount: number; collaborators: Collaborator[] }
const labels = { viewer: 'Pembaca', editor: 'Editor', manager: 'Pengelola' };

export function CollaborationButton({ type, resourceId, collaboratorCount = 0, onChanged, className, mobileIconOnly = false }: {
    type: 'bank' | 'exam'; resourceId: string; collaboratorCount: number | undefined; onChanged?: () => void; className?: string; mobileIconOnly?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<CollaborationData | null>(null);
    const [candidates, setCandidates] = useState<{ id: string; name: string; nip: string }[]>([]);
    const [selected, setSelected] = useState('');
    const [permission, setPermission] = useState<Collaborator['permission']>('editor');
    const [canReset, setCanReset] = useState(false);
    const [expires, setExpires] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [observedAt, setObservedAt] = useState(0);
    const base = `/api/collaboration/${type}/${resourceId}`;
    const count = open && data ? data.activeCount ?? collaboratorCount : collaboratorCount;
    const countLabel = count > 0 ? `${count} kolaborator aktif` : 'Belum ada kolaborator aktif';
    const load = useCallback(async () => {
        const response = await apiGet<CollaborationData>(base);
        if (!response.success) throw new Error(response.error);
        setData(response);
        setObservedAt(Date.now());
        if (response.canShare) {
            const people = await apiGet<{ candidates: typeof candidates }>(`${base}/candidates`);
            if (!people.success) throw new Error(people.error);
            setCandidates(people.candidates);
        }
    }, [base]);
    useEffect(() => {
        if (!open) return;
        let active = true;
        const timer = window.setTimeout(() => { void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Gagal memuat kolaborator.'); }); }, 0);
        return () => { active = false; window.clearTimeout(timer); };
    }, [load, open]);

    const mutate = async (target: string, revoke: boolean) => {
        setBusy(true); setError('');
        try {
            const expiresAt = expires ? new Date(`${expires}T23:59:59`).toISOString() : null;
            const response = await apiSend(`${base}/${encodeURIComponent(target)}`,
                revoke ? undefined : { permission, can_reset: type === 'exam' && permission !== 'viewer' && canReset, expires_at: expiresAt },
                revoke ? 'DELETE' : 'PUT');
            if (!response.success) throw new Error(response.error);
            setSelected(''); setCanReset(false); setExpires('');
            await load(); onChanged?.();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perubahan akses gagal.'); }
        finally { setBusy(false); }
    };

    return <>
        <Button mobileIconOnly={mobileIconOnly} variant="outline" size="sm" className={className} leftIcon={<UserRoundCog size={16} />} type="button" onClick={() => { setData(null); setError(''); setSelected(''); setPermission('editor'); setCanReset(false); setExpires(''); setOpen(true); }}
            aria-label={`Kolaborator: ${countLabel}`} title={countLabel}
            >
            Kolaborator
            {count > 0 && <span aria-hidden="true" className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold leading-none tabular-nums text-white">{count}</span>}
        </Button>
        <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={`Kolaborator ${type === 'bank' ? 'Bank Soal' : 'Ujian'}`} size="lg">
            <ModalBody>
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                {!data && !error && <p className="text-sm text-slate-500">Memuat kolaborator…</p>}
                {data && <>
                    <p className="text-sm text-slate-600">Pembuat: <strong>{data.ownerName}</strong>. Akses ini hanya berlaku untuk {type === 'bank' ? 'bank soal ini' : 'ujian ini'}.</p>
                    <div className="space-y-2">
                        {data.collaborators.filter(row => !row.revoked_at).map(row => {
                            const expired = !!row.expires_at && Date.parse(row.expires_at) <= observedAt;
                            return <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                                <div><p className="text-sm font-semibold">{row.name}</p>
                                    <p className="text-xs text-slate-500">{labels[row.permission]}{row.can_reset ? ' · Reset peserta' : ''}{row.expires_at ? ` · Sampai ${new Date(row.expires_at).toLocaleDateString('id-ID')}` : ' · Tanpa batas waktu'}{expired ? ' · Kedaluwarsa' : ''}</p>
                                </div>
                                {data.canShare && (data.canGrantPrivileged || row.permission !== 'manager') && <div className="flex gap-3">
                                    <button type="button" disabled={busy} className="text-xs font-semibold text-blue-600" onClick={() => { setSelected(row.user_id); setPermission(row.permission); setCanReset(row.can_reset === true && (data.canGrantPrivileged || !expired)); setExpires(row.expires_at ? new Date(row.expires_at).toLocaleDateString('en-CA') : ''); }}>Ubah</button>
                                    <button type="button" disabled={busy} className="text-xs font-semibold text-red-600" onClick={() => void mutate(row.user_id, true)}>Cabut akses</button>
                                </div>}
                            </div>;
                        })}
                        {!data.collaborators.some(row => !row.revoked_at) && <p className="py-3 text-sm text-slate-500">Belum ada kolaborator.</p>}
                    </div>
                    {data.canShare && <div className="space-y-3 border-t border-slate-200 pt-4">
                        <ModalField label="Guru / staf kolaborator">
                            <SearchableSelect value={selected} onChange={value => { setSelected(String(value || '')); setPermission('editor'); setCanReset(false); setExpires(''); }}
                                options={candidates.map(person => ({ value: person.id, label: person.name, subLabel: person.nip }))}
                                placeholder="Pilih guru atau staf" searchPlaceholder="Cari nama atau NIP..." disabled={busy} />
                        </ModalField>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <ModalField label="Hak akses"><InlineSelect value={permission} disabled={busy} onChange={value => setPermission(value as Collaborator['permission'])}
                                options={Object.entries(labels).filter(([value]) => value !== 'manager' || data.canGrantPrivileged).map(([value, label]) => ({ value, label }))} /></ModalField>
                            <ModalField label="Batas akses (opsional)"><DatePicker value={expires} onChange={setExpires} disabled={busy} /></ModalField>
                        </div>
                        <p className="text-xs leading-5 text-slate-500">Pembaca dapat melihat isi. Editor dapat menyunting. Pengelola juga dapat mengatur kolaborator. Menghapus bank/ujian tetap hanya untuk pembuat atau Admin.</p>
                        {!data.canGrantPrivileged && <p className="text-xs leading-5 text-amber-700">Sebagai pengelola, batas akses yang Anda berikan tidak boleh melewati batas akses Anda sendiri. Hak reset yang masih aktif tetap dipertahankan. Hanya pembuat atau Admin yang dapat memberikan atau memperpanjang hak reset.</p>}
                        {data.canGrantPrivileged && type === 'exam' && permission !== 'viewer' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={canReset} onChange={event => setCanReset(event.target.checked)} disabled={busy} />Izinkan reset, pemulihan, dan ujian susulan peserta</label>}
                        <Button type="button" disabled={!selected || busy} onClick={() => void mutate(selected, false)}>Simpan akses</Button>
                    </div>}
                </>}
            </ModalBody>
            <ModalFooter><Button type="button" variant="cancel" disabled={busy} onClick={() => setOpen(false)}>Tutup</Button></ModalFooter>
        </Modal>
    </>;
}
