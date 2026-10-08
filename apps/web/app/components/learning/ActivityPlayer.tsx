'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { learningRequest, LearningRequestError, type LearningMaterial } from '@/lib/learning-api';
import { fetchSessionUser } from '@/lib/session';
import { learningActivityBridge } from '@/lib/learning-activity-bridge';
import { MaterialPreview } from './MaterialPreview';
import { learningStateKey } from '@/lib/learning-state';

type State = Record<string, unknown>;
interface Activity { state: State; revision: number; userId: string; contentVersion: number }
interface Pending { state: State; baseRevision: number; savedAt?: number }
export function ActivityPlayer({ material }: { material: LearningMaterial }) {
    const [activity, setActivity] = useState<Activity | null>(null);
    const [status, setStatus] = useState('Memuat jawaban tersimpan…');
    const [conflict, setConflict] = useState(false);
    const [channel] = useState(() => crypto.randomUUID());
    const bridge = useMemo(() => learningActivityBridge(channel), [channel]);
    const session = useRef<Activity | null>(null);
    const pending = useRef<Pending | null>(null);
    const storageKey = useRef('');
    const sending = useRef(false);
    const stopped = useRef(false);
    const blocked = useRef(false);
    const localFailed = useRef(false);
    const persist = useCallback(() => {
        try {
            if (pending.current) localStorage.setItem(storageKey.current, JSON.stringify(pending.current));
            else localStorage.removeItem(storageKey.current);
            localFailed.current = false; return true;
        } catch { localFailed.current = true; setStatus('Penyimpanan perangkat penuh. Tetap buka halaman sampai jawaban tersimpan di server.'); return false; }
    }, []);
    const sync = useCallback(async () => {
        const current = session.current, draft = pending.current;
        if (!current || !draft || sending.current || stopped.current || blocked.current || !navigator.onLine) return;
        sending.current = true;
        try {
            const user = await fetchSessionUser();
            if (stopped.current || user?.id !== current.userId) { setStatus('Sesi berubah. Jawaban lokal dipertahankan; masuk dengan akun semula.'); return; }
            const response = await learningRequest<{ revision: number }>(`/${material.id}/activity`, { method: 'PUT', body: JSON.stringify({ state: draft.state, revision: draft.baseRevision, contentVersion: current.contentVersion }) });
            current.revision = response.revision;
            if (pending.current === draft) pending.current = null;
            else if (pending.current) pending.current.baseRevision = response.revision;
            persist(); if (!stopped.current) setStatus(pending.current ? 'Perubahan berikutnya menunggu pengiriman…' : 'Jawaban tersimpan');
        } catch (error) {
            if (error instanceof LearningRequestError && error.status === 409) {
                // A lost acknowledgement is safe to recognize only for the exact same state/version.
                const latest = await learningRequest<Activity>(`/${material.id}/activity`).catch(() => null);
                if (latest && latest.userId === current.userId && latest.contentVersion === current.contentVersion && learningStateKey(latest.state) === learningStateKey(draft.state)) {
                    current.revision = latest.revision;
                    if (pending.current === draft) pending.current = null; else if (pending.current) pending.current.baseRevision = latest.revision;
                    persist(); setStatus('Jawaban tersimpan');
                } else { blocked.current = true; setConflict(true); setStatus('Materi atau jawaban berubah di tab lain. Salinan lokal dipertahankan.'); }
            } else {
                if (error instanceof LearningRequestError && [400, 401, 403, 404, 413].includes(error.status)) blocked.current = true;
                setStatus(error instanceof LearningRequestError ? error.message : 'Belum terkirim. Pengiriman dicoba kembali saat terhubung.');
            }
        } finally { sending.current = false; }
    }, [material.id, persist]);
    useEffect(() => {
        stopped.current = false;
        const controller = new AbortController();
        void learningRequest<Activity>(`/${material.id}/activity`, { signal: controller.signal }).then(result => {
            if (controller.signal.aborted) return;
            if (result.contentVersion !== material.content_version) throw new Error('Materi sudah diperbarui. Muat ulang halaman.');
            const prefix = `lms-activity:${result.userId}:${material.id}:${result.contentVersion}`;
            // A fresh mount identity is never inherited by a duplicated tab.
            storageKey.current = `${prefix}:${channel}`;
            try {
                // Each tab owns its queue; another tab must never erase this copy on acknowledgement.
                const own = localStorage.getItem(storageKey.current);
                const copies = own || sessionStorage.getItem(`lms-server:${prefix}`) ? [JSON.parse(own || 'null')] : Object.keys(localStorage).filter(key => key === prefix || key.startsWith(`${prefix}:`)).map(key => {
                    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
                });
                const saved = copies.filter((copy): copy is Pending => !!copy?.state && Number.isInteger(copy.baseRevision)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
                if (saved && Number.isInteger(saved.baseRevision) && saved.state && typeof saved.state === 'object') {
                    pending.current = saved;
                    if (saved.baseRevision !== result.revision && learningStateKey(saved.state) !== learningStateKey(result.state)) { blocked.current = true; setConflict(true); }
                    else if (learningStateKey(saved.state) === learningStateKey(result.state)) pending.current = null;
                }
            } catch { /* Server copy still available when local storage is disabled. */ }
            session.current = result;
            setActivity({ ...result, state: pending.current?.state || result.state });
            setStatus(blocked.current ? 'Ada jawaban lokal dan versi server yang berbeda. Salinan lokal dipertahankan.' : pending.current ? 'Jawaban lokal dipulihkan; menunggu pengiriman…' : 'Jawaban tersimpan');
            void sync();
        }).catch(error => { if (!controller.signal.aborted) setStatus((error as Error).message); });
        const online = () => { void sync(); };
        const beforeUnload = (event: BeforeUnloadEvent) => { if (localFailed.current && pending.current) { event.preventDefault(); event.returnValue = ''; } };
        const interval = window.setInterval(online, 5000);
        window.addEventListener('online', online);
        window.addEventListener('beforeunload', beforeUnload);
        return () => { stopped.current = true; controller.abort(); clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('beforeunload', beforeUnload); };
    }, [material.id, material.content_version, sync, channel]);
    const receive = useCallback((event: MessageEvent) => {
        if (event.data?.channel !== channel || !activity) return;
        if (event.data.type === 'lms-ready') {
            (event.source as Window).postMessage({ type: 'lms-restore', channel, state: pending.current?.state || activity.state }, '*'); return;
        }
        if (event.data.type !== 'lms-state' || !event.data.state || typeof event.data.state !== 'object') return;
        let encoded: string;
        try { encoded = JSON.stringify(event.data.state); } catch { return; }
        if (new TextEncoder().encode(encoded).length > 128 * 1024) { setStatus('Data aktivitas terlalu besar untuk disimpan (maksimum 128 KB).'); return; }
        if (learningStateKey(event.data.state) === learningStateKey(pending.current?.state || session.current?.state)) return;
        pending.current = { state: event.data.state, baseRevision: session.current!.revision, savedAt: Date.now() };
        session.current!.state = event.data.state;
        if (persist()) setStatus(blocked.current ? 'Konflik belum diselesaikan; perubahan tersimpan di perangkat.' : 'Tersimpan di perangkat; menunggu pengiriman…');
    }, [activity, channel, persist]);
    const downloadLocal = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(pending.current?.state || session.current?.state, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'salinan-jawaban.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return <><div className="learn-activity-status" role="status">{status}
        {conflict && <><button onClick={downloadLocal}>Unduh salinan lokal</button><button onClick={() => { if (window.confirm('Gunakan jawaban server? Unduh salinan lokal dahulu jika diperlukan.')) { try { localStorage.removeItem(storageKey.current); sessionStorage.setItem(`lms-server:lms-activity:${activity?.userId}:${material.id}:${material.content_version}`, '1'); window.location.reload(); } catch { setStatus('Tidak dapat menghapus salinan lokal. Unduh jawaban terlebih dahulu.'); } } }}>Gunakan versi server</button></>}
        {!activity && <button onClick={() => window.location.reload()}>Muat ulang</button>}
    </div>{activity && <MaterialPreview material={material} fullPage bridge={bridge} onActivityMessage={receive} />}</>;
}
