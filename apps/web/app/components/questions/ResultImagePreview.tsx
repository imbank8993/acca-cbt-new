"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import './result-image-preview.css';

/** Keep review diagrams compact; the lightbox always uses the original image. */
export function ResultImagePreview({ children, className = '' }: { children: ReactNode; className?: string }) {
    const container = useRef<HTMLDivElement>(null);
    const [image, setImage] = useState<{ src: string; alt: string; width: number; height: number } | null>(null);
    const close = useCallback(() => setImage(null), []);

    useEffect(() => {
        const root = container.current;
        if (!root) return;
        const prepare = () => {
            root.querySelectorAll<HTMLImageElement>('.latex-renderer img, .question-content img').forEach(img => {
                if (img.hasAttribute('data-result-preview') || img.closest('a, button, .katex, .mathjax-inline') ||
                    img.classList.contains('math-equation-img') || img.alt.toLowerCase() === 'equation') return;
                // Retain a teacher's smaller explicit width. Full-width/unsized images use intrinsic sizing.
                const width = img.style.width || (img.getAttribute('width') ? `${img.getAttribute('width')}px` : '');
                if (width && width !== '100%' && width !== 'auto') img.style.setProperty('--result-image-width', width);
                img.setAttribute('data-result-preview', '');
                img.setAttribute('role', 'button');
                img.tabIndex = 0;
                img.setAttribute('aria-label', img.alt ? `Perbesar gambar: ${img.alt}` : 'Perbesar gambar soal');
                img.title = 'Klik untuk memperbesar gambar';
            });
        };
        prepare();
        const observer = new MutationObserver(prepare);
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, []);

    const open = (target: EventTarget | null) => {
        if (!(target instanceof HTMLImageElement) || !target.hasAttribute('data-result-preview')) return;
        setImage({ src: target.currentSrc || target.src, alt: target.alt || 'Gambar soal',
            width: target.naturalWidth, height: target.naturalHeight });
    };

    return <div ref={container} className={`result-image-preview ${className}`}
        onClick={event => open(event.target)}
        onKeyDown={event => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLImageElement && event.target.hasAttribute('data-result-preview')) {
                event.preventDefault();
                open(event.target);
            }
        }}>
        {children}
        <Lightbox open={Boolean(image)} close={close} slides={image ? [image] : []} plugins={[Zoom]}
            carousel={{ finite: true }} controller={{ closeOnBackdropClick: true }}
            render={{ buttonPrev: () => null, buttonNext: () => null }}
            labels={{ Close: 'Tutup', 'Zoom in': 'Perbesar', 'Zoom out': 'Perkecil' }} />
    </div>;
}
