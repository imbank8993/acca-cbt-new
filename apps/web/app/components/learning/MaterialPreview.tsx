'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import type { LearningMaterial } from '@/lib/learning-api';
import { learningPreviewDocument } from '@/lib/learning-preview';
import { PdfPreview } from './PdfPreview';

export function MaterialPreview({ material, fullPage = false, bridge, onActivityMessage }: { material: LearningMaterial; fullPage?: boolean; bridge?: string; onActivityMessage?: (event: MessageEvent) => void }) {
    const frame = useRef<HTMLIFrameElement>(null);
    useEffect(() => {
        const receive = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow) onActivityMessage?.(event); };
        window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
    }, [onActivityMessage]);
    const document = useMemo(() => typeof window !== 'undefined' && material.content_html
        ? learningPreviewDocument(material.content_html, material.format === 'html', bridge) : '', [material.content_html, material.format, bridge]);
    return <div className={`learn-preview${fullPage ? ' learn-preview-fullpage' : ''}`}>
        {!fullPage && <div className="learn-preview-bar"><span>{material.content_html ? 'Halaman baca' : 'Pratinjau berkas'}</span><span>{material.format.toUpperCase()}</span></div>}
        {material.format === 'latex' && material.hasRenderedPdf ? <FilePreview key={`${material.id}:${material.revision}:latex`} material={material} />
            : document ? <iframe ref={frame} title={`Isi bahan ajar: ${material.title}`} className="learn-frame" sandbox={material.format === 'html' ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox' : ''} referrerPolicy="no-referrer" srcDoc={document} />
            : material.hasFile && ['pdf', 'image', 'audio', 'video'].includes(material.format)
                ? <FilePreview key={`${material.id}:${material.revision}:${material.format}`} material={material} />
                : <div className="learn-media"><div><FileDown size={40} style={{ margin: '0 auto 14px' }} /><p>{material.hasFile ? 'Berkas ini dapat dibaca melalui unduhan.' : 'Unggah dokumen untuk melihat hasil konversi di sini.'}</p></div></div>}
    </div>;
}

function FilePreview({ material }: { material: LearningMaterial }) {
    const [media, setMedia] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const abort = new AbortController(); let url = '';
        void (async () => {
            try {
                const response = await fetch(`/api/learning/${material.id}/${material.format === 'latex' && material.hasRenderedPdf ? 'pdf' : 'file'}`, { signal: abort.signal, cache: 'no-store' });
                if (!response.ok) throw new Error('Pratinjau belum dapat dimuat. Coba unduh berkas atau muat ulang halaman.');
                const bytes = await response.arrayBuffer();
                if (abort.signal.aborted) return;
                const extension = material.format === 'latex' && material.hasRenderedPdf ? 'pdf' : material.file_name?.split('.').pop()?.toLowerCase() || '';
                const types: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' };
                url = URL.createObjectURL(new Blob([bytes], { type: types[extension] || 'application/octet-stream' })); setMedia(url);
            } catch (err) { if (!abort.signal.aborted) setError((err as Error).message); }
            finally { if (!abort.signal.aborted) setLoading(false); }
        })();
        return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
    }, [material.id, material.file_name, material.format, material.hasRenderedPdf]);
    return <>{loading ? <div className="learn-media"><Loader2 size={24} />Memuat pratinjau…</div>
            : error ? <div className="learn-media" role="alert">{error}</div>
            : media && (material.format === 'pdf' || material.format === 'latex') ? <PdfPreview url={media} />
            : media ? <div className="learn-media">{material.format === 'image'
                // Blob generated only from an authenticated attachment; no Next image optimization is needed.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={media} alt={material.title} /> : material.format === 'audio' ? <audio src={media} controls /> : <video src={media} controls />}</div>
            : null}</>;
}
