'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Info, Pencil } from 'lucide-react';
import { MaterialPreview } from '@/app/components/learning/MaterialPreview';
import { learningRequest, type LearningMaterial } from '@/lib/learning-api';
import '@/app/components/learning/learning.css';

export default function LearningReader() {
    const { id } = useParams<{ id: string }>();
    const [material, setMaterial] = useState<LearningMaterial | null>(null);
    const [canEdit, setCanEdit] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showInfo, setShowInfo] = useState(false);
    const load = useCallback(async () => {
        setError('');
        try { const result = await learningRequest<{ material: LearningMaterial; canEdit: boolean; completed: boolean }>(`/${id}`); setMaterial(result.material); setCanEdit(result.canEdit); setCompleted(result.completed); }
        catch (err) { setError((err as Error).message); }
    }, [id]);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    const mark = async () => {
        setBusy(true); setError('');
        try { const result = await learningRequest<{ completed: boolean }>(`/${id}/progress`, { method: 'PUT', body: JSON.stringify({ completed: !completed }) }); setCompleted(result.completed); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };
    return <main className="learning learn-fullpage">
        <header className="learn-reader-toolbar">
            <Link className="learn-button" href="/dashboard/learning" aria-label="Kembali ke semua bahan ajar" title="Kembali ke semua bahan ajar"><ArrowLeft size={18} /></Link>
            <div className="learn-reader-title"><h1>{material?.title || 'Bahan ajar'}</h1>{material?.status === 'draft' && <span className="learn-status">Draf · hanya pengelola</span>}</div>
            {material && <div className="learn-reader-actions">
                <button aria-label="Informasi bahan ajar" title="Informasi bahan ajar" aria-expanded={showInfo} aria-controls="learning-reader-info" onClick={() => setShowInfo(value => !value)}><Info size={18} /></button>
                {material.hasFile && <a className="learn-button" href={`/api/learning/${id}/file`} download aria-label="Unduh berkas asli" title="Unduh berkas asli"><Download size={18} /></a>}
                {canEdit && <Link className="learn-button" href={`/dashboard/learning/${id}/edit`} aria-label="Edit materi" title="Edit materi"><Pencil size={18} /></Link>}
                {material.status === 'published' && <button className={completed ? '' : 'learn-primary'} disabled={busy} onClick={() => void mark()} aria-label={completed ? 'Tandai belum selesai' : 'Tandai selesai'} title={completed ? 'Materi sudah dipelajari. Tandai belum selesai' : 'Tandai selesai'}><CheckCircle2 size={18} /><span>{busy ? 'Menyimpan…' : completed ? 'Selesai' : 'Tandai selesai'}</span></button>}
            </div>}
        </header>
        {error && <div className="learn-error" role="alert">{error}<button onClick={() => void load()}>Muat ulang</button></div>}
        {showInfo && material && <section id="learning-reader-info" className="learn-reader-info"><strong>{material.subject || 'Bahan ajar'} · {material.format.toUpperCase()}</strong><p>{material.description}</p><p>{completed ? 'Materi sudah kamu pelajari. ' : ''}Progres tersimpan di akunmu.</p></section>}
        {!material ? !error && <div className="learn-loading">Memuat bahan ajar…</div> : <>
            <MaterialPreview material={material} fullPage />
        </>}
    </main>;
}
