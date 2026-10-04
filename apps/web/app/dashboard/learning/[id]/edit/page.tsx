'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, FileUp, Save, Send } from 'lucide-react';
import { MaterialPreview } from '@/app/components/learning/MaterialPreview';
import { learningRequest, saveMaterial, type LearningMaterial } from '@/lib/learning-api';
import { convertLearningFile } from '@/lib/learning-converter';
import { downloadLearningTemplate } from '@/lib/learning-templates';
import '@/app/components/learning/learning.css';

export default function MaterialEditor() {
    const { id } = useParams<{ id: string }>();
    const [material, setMaterial] = useState<LearningMaterial | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const [denied, setDenied] = useState(false);
    const [preview, setPreview] = useState<LearningMaterial | null>(null);
    const load = useCallback(async () => {
        setError('');
        try {
            const result = await learningRequest<{ material: LearningMaterial; canEdit: boolean }>(`/${id}`);
            if (!result.canEdit) { setDenied(true); return; }
            setMaterial(result.material); setPreview(result.material); setDirty(false);
        } catch (err) { setError((err as Error).message); }
    }, [id]);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
    }, []);
    const edit = (patch: Partial<LearningMaterial>) => { setMaterial(previous => previous ? { ...previous, ...patch } : null); setDirty(true); setNotice(''); };
    const save = async (status: 'draft' | 'published') => {
        if (!material || busy) return;
        setBusy('Menyimpan…'); setError(''); setNotice('');
        try { const result = await saveMaterial(material, status); setMaterial(result.material); setPreview(result.material); setDirty(false); setNotice(status === 'published' ? 'Bahan ajar telah diterbitkan untuk seluruh siswa.' : 'Draf tersimpan. Materi belum terlihat oleh siswa.'); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(''); }
    };
    const upload = async (file?: File) => {
        if (!file || !material || busy) return;
        setBusy('Mengonversi dokumen…'); setError(''); setNotice('');
        try {
            const converted = await convertLearningFile(file);
            setBusy('Mengunggah berkas asli…');
            const data = new FormData(); data.append('file', file); data.append('revision', String(material.revision));
            const uploaded = await learningRequest<{ material: LearningMaterial }>(`/${id}/file`, { method: 'POST', body: data });
            const next: LearningMaterial = { ...uploaded.material, title: material.title, description: material.description, subject: material.subject,
                format: converted.format, content_html: converted.html, conversion_notes: converted.notes.join('\n') };
            setMaterial(next); setPreview(next); setDirty(true);
            setBusy('Menyimpan hasil konversi…');
            const saved = await saveMaterial(next, 'draft');
            setMaterial(saved.material); setPreview(saved.material); setDirty(false); setNotice('Dokumen tersimpan sebagai draf. Periksa pratinjau sebelum menerbitkan.');
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(''); }
    };
    const template = async (format: 'word' | 'latex' | 'html') => {
        try { await downloadLearningTemplate(format); } catch { setError('Template gagal dibuat. Silakan coba lagi.'); }
    };
    return <main className="learning">
        <Link className="learn-back" href="/dashboard/learning" onClick={event => { if (dirty && !window.confirm('Perubahan belum disimpan. Tetap keluar?')) event.preventDefault(); }}><ArrowLeft size={16} />Kembali ke bahan ajar</Link>
        <header className="learn-header"><div><div className="learn-eyebrow">Pengelolaan materi</div><h1>Susun bahan ajar</h1><p>Unggah, periksa, lalu terbitkan untuk seluruh siswa.</p></div>{material && <div className="learn-actions"><button disabled={!!busy} onClick={() => void save('draft')}><Save size={16} />Simpan draf</button><button className="learn-primary" disabled={!!busy || !material.title.trim() || (!material.content_html && !material.hasFile)} onClick={() => void save('published')}><Send size={16} />{material.status === 'published' ? 'Perbarui materi' : 'Terbitkan'}</button></div>}</header>
        {error && <div className="learn-error" role="alert">{error}{!material && <button onClick={() => void load()}>Coba lagi</button>}</div>}
        {notice && <div className="learn-success" role="status">{notice}</div>}
        {busy && <div className="learn-success" role="status">{busy}</div>}
        {denied ? <div className="learn-empty"><h2>Akses pengelolaan tidak tersedia</h2><p>Materi ini hanya dapat diubah oleh pembuatnya atau admin.</p></div> : !material ? !error && <div className="learn-loading">Memuat draf…</div> : <div className="learn-editor">
            <aside><section className="learn-panel"><h2>Informasi bahan ajar</h2><div className="learn-field"><label htmlFor="material-title">Judul</label><input id="material-title" maxLength={200} value={material.title} disabled={!!busy} onChange={event => edit({ title: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-subject">Mata pelajaran / topik</label><input id="material-subject" placeholder="Contoh: Matematika" maxLength={100} value={material.subject} disabled={!!busy} onChange={event => edit({ subject: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-description">Deskripsi singkat</label><textarea id="material-description" placeholder="Apa yang akan dipelajari siswa?" maxLength={4000} value={material.description} disabled={!!busy} onChange={event => edit({ description: event.target.value })} /></div>
                <span className={`learn-status ${material.status}`}>{material.status === 'published' ? 'Terbit · semua siswa' : 'Draf · belum dibagikan'}</span>{dirty && <small style={{ marginLeft: 8 }}>Belum disimpan</small>}
            </section><section className="learn-panel"><h2>Dokumen sumber</h2><label className="learn-upload"><FileUp size={28} /><span>Pilih berkas bahan ajar</span><input aria-label="Unggah bahan ajar" type="file" disabled={!!busy || material.status === 'published'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} /></label>
                <p style={{ fontSize: 12, marginTop: 12 }}>Word (.docx/.dotx), LaTeX (.tex), HTML, PDF, gambar, media, atau lampiran lain. Maksimum 25 MB.</p>
                {material.status === 'published' && <p style={{ fontSize: 12, marginTop: 10 }}>Simpan sebagai draf untuk mengganti berkas.</p>}
                {material.file_name && <div className="learn-file"><strong>{material.file_name}</strong><br />{((material.file_size || 0) / 1024).toFixed(0)} KB · <a href={`/api/learning/${id}/file`} download>Unduh berkas asli</a></div>}
            </section><section className="learn-panel"><h2>Mulai dari template</h2><p style={{ fontSize: 13 }}>Unduh contoh, sesuaikan isinya, lalu unggah kembali.</p><div className="learn-template-list"><button onClick={() => void template('word')}>Word</button><button onClick={() => void template('latex')}>LaTeX</button><button onClick={() => void template('html')}>HTML interaktif</button></div></section></aside>
            <section><div className="learn-actions" style={{ marginBottom: 16 }}><button disabled={!!busy} onClick={() => setPreview(material)}><Eye size={16} />Perbarui pratinjau</button><Link className="learn-button" href={`/dashboard/learning/${id}`} onClick={event => { if (dirty && !window.confirm('Pratinjau siswa memakai versi tersimpan. Tetap lanjut?')) event.preventDefault(); }}>Buka halaman baca</Link></div>
                {material.conversion_notes && <details className="learn-notes" open><summary>Catatan konversi</summary><ul>{material.conversion_notes.split('\n').filter(Boolean).map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
                {preview && <MaterialPreview material={preview} />}
                {['word', 'latex', 'html', 'text'].includes(material.format) && <details className="learn-panel" style={{ marginTop: 20 }}><summary style={{ cursor: 'pointer' }}>Sunting hasil konversi (HTML)</summary><p style={{ fontSize: 13, margin: '12px 0' }}>Perubahan berlaku pada halaman baca. Berkas asli tetap tersedia.</p><textarea className="learn-source" aria-label="Isi HTML bahan ajar" maxLength={6_000_000} value={material.content_html} disabled={!!busy} onChange={event => edit({ content_html: event.target.value })} /></details>}
            </section>
        </div>}
    </main>;
}
