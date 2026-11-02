'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { confirmDialog } from '@/lib/confirm-dialog';
import { learningRequest, saveMaterial, type LearningMaterial } from '@/lib/learning-api';
import { MaterialPreview } from './MaterialPreview';

/** Format yang isinya tersimpan sebagai HTML dan aman disunting langsung (LaTeX memakai PDF hasil kompilasi). */
export const HTML_EDITABLE_FORMATS = ['html', 'word', 'text'];

/**
 * Sunting sumber HTML satu subbab langsung dari halaman Bahan Ajar.
 * Isi diambil ulang dari server (daftar tidak memuat `content_html`) dan disimpan
 * lewat endpoint yang sama dengan halaman edit, sehingga pemeriksaan pemilik/Admin
 * dan konflik revisi tetap ditegakkan di server.
 */
export function HtmlSourceEditorModal({ materialId, title, onClose, onSaved }: {
    materialId: string;
    title: string;
    onClose: () => void;
    onSaved: (material: LearningMaterial) => void;
}) {
    const [material, setMaterial] = useState<LearningMaterial | null>(null);
    const [source, setSource] = useState('');
    const [preview, setPreview] = useState<LearningMaterial | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const editor = useRef<HTMLTextAreaElement>(null);
    const dirty = !!material && source !== material.content_html;

    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const result = await learningRequest<{ material: LearningMaterial; canEdit: boolean }>(`/${materialId}`, { signal: controller.signal });
                if (controller.signal.aborted) return;
                if (!result.canEdit) throw new Error('Materi ini hanya dapat diubah oleh pembuatnya atau admin.');
                if (!HTML_EDITABLE_FORMATS.includes(result.material.format) || result.material.hasRenderedPdf) {
                    throw new Error('Materi ini bukan berformat HTML. Ubah isinya dengan mengunggah ulang berkas di halaman edit.');
                }
                setMaterial(result.material); setSource(result.material.content_html); setPreview(result.material);
            } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
            finally { if (!controller.signal.aborted) setLoading(false); }
        })();
        return () => controller.abort();
    }, [materialId]);

    // Pratinjau diperbarui setelah mengetik berhenti sejenak, agar iframe tidak dimuat ulang setiap ketukan.
    useEffect(() => {
        if (!material) return;
        const timer = window.setTimeout(() => setPreview(current => current && current.content_html === source ? current : { ...material, content_html: source }), 600);
        return () => window.clearTimeout(timer);
    }, [source, material]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(''), 3000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const save = useCallback(async () => {
        if (!material || !dirty || saving) return;
        if (!source.trim() && material.status === 'published' && !material.hasFile) {
            setError('Materi terbit tidak boleh kosong. Isi HTML-nya atau kembalikan ke draf di halaman edit.');
            return;
        }
        setSaving(true); setError(''); setNotice('');
        try {
            const result = await saveMaterial({ ...material, content_html: source });
            setMaterial(result.material); setSource(result.material.content_html); setPreview(result.material);
            setNotice(result.material.status === 'published' ? 'Tersimpan dan langsung terlihat oleh siswa.' : 'Tersimpan sebagai draf.');
            onSaved(result.material);
        } catch (err) { setError((err as Error).message); }
        finally { setSaving(false); }
    }, [material, dirty, saving, source, onSaved]);

    const requestClose = useCallback(async () => {
        if (saving) return;
        if (dirty && !await confirmDialog({ title: 'Tutup tanpa menyimpan?', text: 'Perubahan HTML yang belum disimpan akan hilang.', confirmText: 'Tutup', cancelText: 'Kembali', variant: 'warning' })) return;
        onClose();
    }, [dirty, saving, onClose]);

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            // Tab menyisipkan indentasi; Esc lalu Tab tetap bisa dipakai untuk keluar dari editor.
            event.preventDefault();
            event.currentTarget.setRangeText('  ', event.currentTarget.selectionStart, event.currentTarget.selectionEnd, 'end');
            setSource(event.currentTarget.value);
        }
    };

    return <Modal open onClose={() => void requestClose()} size="2xl" labelledBy="lc-html-editor-title" closeOnOverlayClick={false} className="lc-html-editor-modal">
        <ModalHeader id="lc-html-editor-title" title={`Edit HTML · ${title}`}
            subtitle={material ? `${material.format.toUpperCase()} · ${material.status === 'published' ? 'Terbit — perubahan langsung terlihat siswa setelah disimpan' : 'Draf — belum terlihat siswa'}` : undefined}
            onClose={() => void requestClose()} />
        <ModalBody>
            {error && <p role="alert" className="lc-html-editor-alert"><AlertTriangle size={14} aria-hidden="true" />{error}</p>}
            {loading ? <p className="lc-html-editor-loading" role="status">Memuat isi materi…</p> : material && <div className="lc-html-editor">
                <label className="lc-html-editor-pane">
                    <span>Kode HTML</span>
                    <textarea ref={editor} aria-label="Kode HTML materi" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={6_000_000}
                        value={source} onChange={event => setSource(event.target.value)} onKeyDown={onKeyDown} disabled={saving} />
                </label>
                <div className="lc-html-editor-pane">
                    <span>Pratinjau</span>
                    {preview && <MaterialPreview material={preview} />}
                </div>
            </div>}
        </ModalBody>
        <ModalFooter align="between">
            <span className="lc-html-editor-status" role="status">
                {notice ? <><CheckCircle2 size={14} aria-hidden="true" />{notice}</> : dirty ? 'Ada perubahan yang belum disimpan · Ctrl+S untuk menyimpan' : material ? 'Tidak ada perubahan' : ''}
            </span>
            <div className="lc-html-editor-actions">
                <Button variant="outline" onClick={() => void requestClose()} disabled={saving}>Tutup</Button>
                <Button onClick={() => void save()} disabled={!dirty || saving || !material} isLoading={saving}>Simpan</Button>
            </div>
        </ModalFooter>
    </Modal>;
}
