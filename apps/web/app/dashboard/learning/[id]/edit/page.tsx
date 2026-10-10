'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Eye, FileUp, Save, Send, Trash2 } from 'lucide-react';
import { MaterialPreview } from '@/app/components/learning/MaterialPreview';
import { deleteMaterial, learningRequest, saveMaterial, type LearningMaterial } from '@/lib/learning-api';
import { convertLearningFile } from '@/lib/learning-converter';
import { downloadLearningTemplate } from '@/lib/learning-templates';
import { learningPreviewDocument } from '@/lib/learning-preview';
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { fetchSessionUser } from '@/lib/session';
import { ActivityResults } from '@/app/components/learning/ActivityResults';
import '@/app/components/learning/learning.css';

export default function MaterialEditor() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [material, setMaterial] = useState<LearningMaterial | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const [denied, setDenied] = useState(false);
    const [preview, setPreview] = useState<LearningMaterial | null>(null);
    const draftKey = useRef('');
    const owner = useRef('');
    const [recovery, setRecovery] = useState<LearningMaterial | null>(null);
    const keepDraft = (next: LearningMaterial) => {
        try { localStorage.setItem(draftKey.current, JSON.stringify(next)); }
        catch { setError('Salinan lokal tidak dapat disimpan. Simpan draf sebelum meninggalkan halaman.'); }
    };
    const clearDraft = () => { try { localStorage.removeItem(draftKey.current); } catch { /* Saved server copy remains authoritative. */ } };
    const load = useCallback(async () => {
        setError('');
        try {
            const user = await fetchSessionUser();
            if (!user) throw new Error('Silakan login kembali.');
            owner.current = user.id; draftKey.current = `lms-draft:${user.id}:${id}`;
            const result = await learningRequest<{ material: LearningMaterial; canEdit: boolean }>(`/${id}`);
            if (!result.canEdit) { setDenied(true); return; }
            setMaterial(result.material); setPreview(result.material); setDirty(false);
            try {
                const saved = JSON.parse(localStorage.getItem(draftKey.current) || 'null') as LearningMaterial | null;
                if (saved?.id === id) {
                    if (saved.revision === result.material.revision) { setMaterial(saved); setPreview(saved); setDirty(true); setNotice('Perubahan yang belum tersimpan dipulihkan dari perangkat.'); }
                    else { setRecovery(saved); setNotice('Ada salinan lokal dari versi lain. Periksa sebelum memulihkannya.'); }
                }
            } catch { /* No usable local draft. */ }
        } catch (err) { setError((err as Error).message); }
    }, [id]);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
    }, []);
    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(''), 3500);
        return () => window.clearTimeout(timer);
    }, [notice]);
    const edit = (patch: Partial<LearningMaterial>) => {
        if (!material) return;
        const next = { ...material, ...patch }; keepDraft(next); setMaterial(next); dirtyRef.current = true; setDirty(true); setNotice('');
    };
    const save = useCallback(async (status: 'draft' | 'published') => {
        if (!material || busy) return;
        setBusy('Menyimpan…'); setError(''); setNotice('');
        try {
            if ((await fetchSessionUser())?.id !== owner.current) throw new Error('Akun berubah. Masuk dengan akun semula untuk menyimpan draf.');
            const result = await saveMaterial(material, status); setMaterial(result.material); setPreview(result.material); setDirty(false); clearDraft();
            setNotice(status === 'published' ? 'Bahan ajar telah diterbitkan untuk seluruh siswa.' : 'Draf tersimpan. Materi belum terlihat oleh siswa.');
        }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(''); }
    }, [material, busy]);
    const upload = async (file?: File) => {
        if (!file || !material || busy) return;
        setBusy('Mengonversi dokumen…'); setError(''); setNotice('');
        try {
            const converted = await convertLearningFile(file);
            if ((await fetchSessionUser())?.id !== owner.current) throw new Error('Akun berubah. Masuk dengan akun semula untuk mengunggah.');
            setBusy('Mengunggah berkas asli…');
            const data = new FormData(); data.append('file', file);
            for (const [key, value] of Object.entries({ revision: material.revision, title: material.title, description: material.description,
                subject: material.subject, gradeLevel: material.grade_level || '', topic: material.topic || '', subtopic: material.subtopic || '', status: material.status, format: converted.format, contentHtml: converted.html, conversionNotes: converted.notes.join('\n') })) data.append(key, String(value));
            const uploaded = await learningRequest<{ material: LearningMaterial }>(`/${id}/file`, { method: 'POST', body: data });
            setMaterial(uploaded.material); setPreview(uploaded.material); setDirty(false); clearDraft();
            setNotice(uploaded.material.status === 'published' ? 'Berkas baru berhasil diunggah dan materi diperbarui.' : 'Dokumen dan hasil konversi tersimpan bersama sebagai draf.');
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(''); }
    };
    const handleDelete = async () => {
        if (!material) return;
        if (!await deleteConfirmDialog('Hapus Bahan Ajar?', `Apakah Anda yakin ingin menghapus bahan ajar "${material.title}"? Seluruh berkas dan data terkait akan dihapus secara permanen.`)) return;
        setBusy('Menghapus materi…'); setError('');
        try {
            await deleteMaterial(material.id);
            clearDraft();
            router.push('/dashboard/learning');
        } catch (err) {
            setError((err as Error).message);
            setBusy('');
        }
    };
    const template = async (format: 'word' | 'latex' | 'html') => {
        try { await downloadLearningTemplate(format); } catch { setError('Template gagal dibuat. Silakan coba lagi.'); }
    };
    const openDirectly = () => {
        if (!material?.content_html) return;
        const doc = learningPreviewDocument(material.content_html, true);
        const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    };
    return <main className="learning">
        <div className="learn-editor-topbar">
            <Link className="learn-back" href="/dashboard/learning" onClick={event => { if (dirty && !window.confirm('Perubahan belum disimpan. Tetap keluar?')) event.preventDefault(); }}><ArrowLeft size={16} />Kembali ke bahan ajar</Link>
            {material && <div className="learn-actions">
                {busy && <span className="learn-status-pill saving" role="status">{busy}</span>}
                {notice && <span className="learn-status-pill saved" role="status">{notice}</span>}
                <button type="button" className="learn-btn-icon-danger" disabled={!!busy} onClick={() => void handleDelete()} title="Hapus bahan ajar">
                    <Trash2 size={16} />Hapus materi
                </button>
                <button disabled={!!busy} onClick={() => void save('draft')}><Save size={16} />Simpan draf</button>
                <button className="learn-primary" disabled={!!busy || !material.title.trim() || (!material.content_html && !material.hasFile)} onClick={() => void save('published')}><Send size={16} />{material.status === 'published' ? 'Perbarui materi' : 'Terbitkan'}</button>
            </div>}
        </div>
        {error && <div className="learn-error" role="alert">{error}{!material && <button onClick={() => void load()}>Coba lagi</button>}</div>}
        {recovery && material && <div className="learn-notes">Versi server telah berubah. Pemulihan mengganti isi editor dengan salinan lokal, lalu perlu disimpan.
            <button disabled={!!busy} onClick={() => { const next = { ...material, title: recovery.title, description: recovery.description, subject: recovery.subject, grade_level: recovery.grade_level || '', topic: recovery.topic || '', subtopic: recovery.subtopic || '', content_html: recovery.content_html, format: recovery.format, conversion_notes: recovery.conversion_notes }; keepDraft(next); setMaterial(next); setPreview(next); setDirty(true); setRecovery(null); }}>Pulihkan isi lokal</button>
            <button disabled={!!busy} onClick={() => { clearDraft(); setRecovery(null); }}>Gunakan versi server</button>
        </div>}
        {denied ? <div className="learn-empty"><h2>Akses pengelolaan tidak tersedia</h2><p>Materi ini hanya dapat diubah oleh pembuatnya atau admin.</p></div> : !material ? !error && <div className="learn-loading">Memuat draf…</div> : <div className="learn-editor">
            <aside><section className="learn-panel"><h2>Informasi bahan ajar</h2><div className="learn-field"><label htmlFor="material-title">Judul</label><input id="material-title" maxLength={200} value={material.title} onChange={event => edit({ title: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-subject">Mata pelajaran</label><input id="material-subject" placeholder="Contoh: Matematika" maxLength={100} value={material.subject} onChange={event => edit({ subject: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-grade">Tingkatan kelas</label><select id="material-grade" value={material.grade_level || ''} onChange={event => edit({ grade_level: event.target.value })}><option value="">Semua tingkatan</option>{Array.from({ length: 12 }, (_, i) => String(i + 1)).map(grade => <option key={grade} value={grade}>Kelas {grade}</option>)}</select></div>
                <div className="learn-field"><label htmlFor="material-topic">Materi</label><input id="material-topic" placeholder="Contoh: Persamaan kuadrat" maxLength={200} value={material.topic || ''} onChange={event => edit({ topic: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-subtopic">Submateri</label><input id="material-subtopic" placeholder="Contoh: Menentukan akar persamaan" maxLength={200} value={material.subtopic || ''} onChange={event => edit({ subtopic: event.target.value })} /></div>
                <div className="learn-field"><label htmlFor="material-description">Deskripsi singkat</label><textarea id="material-description" placeholder="Apa yang akan dipelajari siswa?" maxLength={4000} value={material.description} onChange={event => edit({ description: event.target.value })} /></div>
                <span className={`learn-status ${material.status}`}>{material.status === 'published' ? 'Terbit · semua siswa' : 'Draf · belum dibagikan'}</span>{dirty && <small style={{ marginLeft: 8 }}>Belum disimpan</small>}
            </section><section className="learn-panel"><h2>Dokumen sumber</h2><label className="learn-upload"><FileUp size={28} /><span>Pilih berkas bahan ajar</span><input aria-label="Unggah bahan ajar" type="file" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} /></label>
                <p style={{ fontSize: 12, marginTop: 12 }}>Word (.docx/.dotx), LaTeX (.tex atau .zip dengan main.tex), HTML, PDF, gambar, media, atau lampiran lain. Maksimum 25 MB (TeX: 500 KB).</p><p style={{ fontSize: 12 }}>Untuk proyek bergambar, unggah ZIP berisi main.tex di folder teratas. Sertakan folder gambar sesuai lokasi yang dirujuk dalam TeX.</p>
                {material.status === 'published' && <p style={{ fontSize: 12, marginTop: 10, color: '#2563EB', fontWeight: 500 }}>Unggah berkas baru untuk langsung memperbarui materi ini.</p>}
                {material.hasRenderedPdf && <a className="learn-button" href={`/api/learning/${id}/pdf`} download>Unduh PDF hasil LaTeX</a>}
                {material.file_name && <div className="learn-file"><strong>{material.file_name}</strong><br />{((material.file_size || 0) / 1024).toFixed(0)} KB · <a href={`/api/learning/${id}/file`} download>Unduh berkas asli</a></div>}
            </section><section className="learn-panel"><h2>Mulai dari template</h2><p style={{ fontSize: 13 }}>Unduh contoh, sesuaikan isinya, lalu unggah kembali.</p><div className="learn-template-list"><button onClick={() => void template('word')}>Word</button><button onClick={() => void template('latex')}>LaTeX</button><button onClick={() => void template('html')}>HTML interaktif</button></div></section></aside>
            <section><div className="learn-actions" style={{ marginBottom: 16 }}><button disabled={!!busy} onClick={() => setPreview(material)}><Eye size={16} />Perbarui pratinjau</button>
                {material.format === 'html' && material.content_html && (
                    <button type="button" className="learn-button" disabled={!!busy} onClick={openDirectly} title="Buka langsung di tab browser baru">
                        <ExternalLink size={16} />Buka langsung di browser
                    </button>
                )}
                <Link className="learn-button" href={`/dashboard/learning/${id}`} onClick={event => { if (dirty && !window.confirm('Pratinjau siswa memakai versi tersimpan. Tetap lanjut?')) event.preventDefault(); }}>Buka halaman baca</Link></div>
                {material.format === 'latex' && !material.hasRenderedPdf && <div className="learn-notes">Materi ini masih memakai konversi HTML lama. Simpan sebagai draf lalu unggah ulang file TeX untuk mendapatkan tata letak PDF asli.</div>}
                {material.conversion_notes && <details className="learn-notes" open><summary>Catatan konversi</summary><ul>{material.conversion_notes.split('\n').filter(Boolean).map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
                {preview && <MaterialPreview material={preview} />}
                <ActivityResults id={id} />
                {['word', 'html', 'text'].includes(material.format) && <details className="learn-panel" style={{ marginTop: 20 }}><summary style={{ cursor: 'pointer' }}>Sunting hasil konversi (HTML)</summary><p style={{ fontSize: 13, margin: '12px 0' }}>Perubahan berlaku pada halaman baca. Berkas asli tetap tersedia.</p><textarea className="learn-source" aria-label="Isi HTML bahan ajar" maxLength={6_000_000} value={material.content_html} onChange={event => edit({ content_html: event.target.value })} /></details>}
            </section>
        </div>}
    </main>;
}
