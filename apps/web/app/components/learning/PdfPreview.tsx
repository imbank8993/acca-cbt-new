'use client';
import { useEffect, useRef, useState } from 'react';
import { pdfRenderSize } from '@/lib/pdf-render-size';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Render pages as pixels; never run embedded PDF actions/scripts in an app-origin document. */
export function PdfPreview({ url }: { url: string }) {
    const container = useRef<HTMLDivElement>(null);
    const [display, setDisplay] = useState({ width: 0, ratio: 1 });
    const canvas = useRef<HTMLCanvasElement>(null);
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
    const [page, setPage] = useState(1);
    const [error, setError] = useState('');
    const [rendering, setRendering] = useState(true);
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        const measure = () => {
            const width = Math.max(1, element.clientWidth - 32);
            const ratio = window.devicePixelRatio || 1;
            setDisplay(previous => previous.width === width && previous.ratio === ratio ? previous : { width, ratio });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        window.addEventListener('resize', measure);
        let resolution: MediaQueryList;
        const watchResolution = () => {
            resolution?.removeEventListener('change', watchResolution);
            measure();
            resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            resolution.addEventListener('change', watchResolution);
        };
        watchResolution();
        return () => { observer.disconnect(); window.removeEventListener('resize', measure); resolution?.removeEventListener('change', watchResolution); };
    }, []);
    useEffect(() => {
        setPdf(null); setPage(1); setError(''); setRendering(true);
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
        if (!pdf || !display.width) return;
        setRendering(true); setError('');
        let cancelled = false; let task: { cancel(): void } | undefined;
        void (async () => {
            try {
                const documentPage = await pdf.getPage(page);
                if (cancelled || !canvas.current) return;
                const natural = documentPage.getViewport({ scale: 1 });
                const size = pdfRenderSize(natural.width, natural.height, display.width, display.ratio);
                const viewport = documentPage.getViewport({ scale: size.scale });
                // Render into a private canvas so cancelled renders cannot race over the visible canvas.
                const buffer = document.createElement('canvas');
                buffer.width = size.width; buffer.height = size.height;
                const context = buffer.getContext('2d'); if (!context) throw new Error();
                const render = documentPage.render({ canvasContext: context, viewport }); task = render;
                await render.promise;
                if (cancelled || !canvas.current) return;
                canvas.current.width = size.width; canvas.current.height = size.height;
                const target = canvas.current.getContext('2d'); if (!target) throw new Error();
                target.drawImage(buffer, 0, 0);
                buffer.width = 0; buffer.height = 0;
                if (!cancelled) setRendering(false);
            } catch { if (!cancelled) { setError('Halaman PDF tidak dapat ditampilkan.'); setRendering(false); } }
        })();
        return () => { cancelled = true; task?.cancel(); };
    }, [pdf, page, display]);
    return <div ref={container} style={{ padding: 16 }}>
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
