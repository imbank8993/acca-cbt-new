'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Render pages as pixels; never run embedded PDF actions/scripts in an app-origin document. */
export function PdfPreview({ url }: { url: string }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
    const [page, setPage] = useState(1);
    const [error, setError] = useState('');
    const [rendering, setRendering] = useState(true);
    useEffect(() => {
        let cancelled = false; let task: { destroy(): Promise<void> } | undefined;
        void (async () => {
            try {
                const pdfjs = await import('pdfjs-dist');
                if (cancelled) return;
                pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/lms.worker.min.mjs?v=${pdfjs.version}`;
                const loading = pdfjs.getDocument({ url, isEvalSupported: false }); task = loading;
                const document = await loading.promise;
                if (!cancelled) setPdf(document);
            } catch { if (!cancelled) setError('PDF tidak dapat dipratinjau. Gunakan unduhan berkas asli.'); }
        })();
        return () => { cancelled = true; void task?.destroy(); };
    }, [url]);
    useEffect(() => {
        if (!pdf) return;
        let cancelled = false; let task: { cancel(): void } | undefined;
        void (async () => {
            try {
                const documentPage = await pdf.getPage(page);
                if (cancelled || !canvas.current) return;
                const viewport = documentPage.getViewport({ scale: 1.5 });
                const context = canvas.current.getContext('2d'); if (!context) throw new Error();
                canvas.current.width = viewport.width; canvas.current.height = viewport.height;
                const render = documentPage.render({ canvasContext: context, viewport }); task = render;
                await render.promise;
                if (!cancelled) setRendering(false);
            } catch { if (!cancelled) { setError('Halaman PDF tidak dapat ditampilkan.'); setRendering(false); } }
        })();
        return () => { cancelled = true; task?.cancel(); };
    }, [pdf, page]);
    return <div style={{ padding: 16 }}>
        {error ? <p role="alert">{error}</p> : <>
            <div className="learn-actions" style={{ justifyContent: 'center', marginBottom: 16 }}>
                <button disabled={!pdf || page <= 1 || rendering} onClick={() => { setRendering(true); setPage(value => value - 1); }}>Sebelumnya</button>
                <span aria-live="polite">Halaman {page} / {pdf?.numPages || '…'}</span>
                <button disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => { setRendering(true); setPage(value => value + 1); }}>Berikutnya</button>
            </div>
            {rendering && <p role="status">Memuat halaman PDF…</p>}
            <canvas ref={canvas} aria-label={`Pratinjau halaman ${page} PDF`} style={{ display: 'block', width: '100%', height: 'auto' }} />
        </>}
    </div>;
}
