"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Lightbox, { IconButton, isImageSlide, type RenderSlideProps, type ZoomRef } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { RotateCcw, ZoomIn } from 'lucide-react';
import 'yet-another-react-lightbox/styles.css';
import './zoomable-images.css';

declare module 'yet-another-react-lightbox' {
    interface Labels {
        /** Reset button added by ImageZoomViewer */
        'Reset zoom'?: string;
    }
}

type ZoomImage = { src: string; alt: string; width: number; height: number };

/** Links and math never open the viewer. */
const SKIP_SELECTOR = 'a, .katex, .mathjax-inline';
/** A click on these selects an answer, so their images get a separate magnifier. */
const INTERACTIVE_SELECTOR = 'label, button, [role="button"], [role="radio"], [role="checkbox"], [data-cbt-option]';

function isMathImage(img: HTMLImageElement): boolean {
    return img.classList.contains('math-equation-img') || img.alt.toLowerCase() === 'equation';
}

function markImages(root: HTMLElement, compact: boolean) {
    const selector = compact ? '.latex-renderer img, .question-content img' : 'img';
    root.querySelectorAll<HTMLImageElement>(selector).forEach(img => {
        if (img.hasAttribute('data-zoomable-image') || img.closest(SKIP_SELECTOR) || isMathImage(img)) return;
        if (img.closest(INTERACTIVE_SELECTOR)) {
            img.setAttribute('data-zoomable-image', 'inline');
            return;
        }
        if (compact) {
            // Retain a teacher's smaller explicit width. Full-width/unsized images use intrinsic sizing.
            const width = img.style.width || (img.getAttribute('width') ? `${img.getAttribute('width')}px` : '');
            if (width && width !== '100%' && width !== 'auto') img.style.setProperty('--result-image-width', width);
        }
        img.setAttribute('data-zoomable-image', 'direct');
        img.setAttribute('role', 'button');
        img.tabIndex = 0;
        img.setAttribute('aria-label', img.alt ? `Perbesar gambar: ${img.alt}` : 'Perbesar gambar soal');
        img.title = 'Klik untuk memperbesar gambar';
    });
}

/**
 * Small figures open already fitted to the screen; the zoom plugin then allows
 * up to 4x more. Slide dimensions are what the plugin uses to size the image.
 */
function slideFor(img: HTMLImageElement): ZoomImage {
    const rect = img.getBoundingClientRect();
    const naturalWidth = img.naturalWidth || Math.round(rect.width) || 800;
    const naturalHeight = img.naturalHeight || Math.round(rect.height) || 600;
    const fit = Math.min((window.innerWidth * 0.92) / naturalWidth, (window.innerHeight * 0.8) / naturalHeight);
    const scale = Math.max(1, Math.min(fit, 6));
    return {
        src: img.currentSrc || img.src,
        alt: img.alt || 'Gambar soal',
        width: Math.round(naturalWidth * scale),
        height: Math.round(naturalHeight * scale),
    };
}

function renderZoomSlide({ slide, rect }: RenderSlideProps) {
    if (!isImageSlide(slide) || !slide.width || !slide.height) return undefined;
    const fit = Math.min(rect.width / slide.width, rect.height / slide.height, 1);
    return <img src={slide.src} alt={slide.alt ?? ''} draggable={false}
        className="yarl__slide_image cbt-image-zoom__img"
        style={{ width: Math.round(slide.width * fit), height: Math.round(slide.height * fit), maxWidth: 'none', maxHeight: 'none' }} />;
}

export function ImageZoomViewer({ image, onClose }: { image: ZoomImage | null; onClose: () => void }) {
    const zoomRef = useRef<ZoomRef>(null);
    const [zoom, setZoom] = useState(1);
    useEffect(() => { if (image) setZoom(1); }, [image]);

    return <Lightbox open={Boolean(image)} close={onClose} slides={image ? [image] : []} plugins={[Zoom]}
        className="cbt-image-zoom"
        carousel={{ finite: true, padding: '16px' }}
        controller={{ closeOnBackdropClick: true }}
        zoom={{ ref: zoomRef, maxZoomPixelRatio: 4, scrollToZoom: true, zoomInMultiplier: 1.5, doubleClickMaxStops: 2 }}
        on={{ zoom: ({ zoom: level }) => setZoom(level) }}
        toolbar={{
            buttons: [
                <span key="level" className="cbt-image-zoom__level" aria-live="polite">{Math.round(zoom * 100)}%</span>,
                'zoom',
                <IconButton key="reset" label="Reset zoom" icon={RotateCcw} disabled={zoom <= 1.001}
                    onClick={() => zoomRef.current?.changeZoom(1)} />,
                'close',
            ],
        }}
        render={{
            buttonPrev: () => null,
            buttonNext: () => null,
            slide: renderZoomSlide,
            controls: () => <div className="cbt-image-zoom__hint">
                Scroll mouse atau tombol + / − untuk zoom · seret untuk menggeser · klik di luar gambar untuk menutup
            </div>,
        }}
        labels={{ Close: 'Tutup', 'Zoom in': 'Perbesar', 'Zoom out': 'Perkecil', 'Reset zoom': 'Ukuran awal' }} />;
}

/**
 * Lets every content image inside open in a zoom viewer. Images in the
 * question open on click; images inside answer options keep "click selects"
 * and show a magnifier button on hover instead. `compact` keeps result-page
 * images small (see result-image-preview.css).
 */
export function ZoomableImages({ children, className = '', compact = false }: { children: ReactNode; className?: string; compact?: boolean }) {
    const container = useRef<HTMLDivElement>(null);
    const [image, setImage] = useState<ZoomImage | null>(null);
    const [trigger, setTrigger] = useState<{ img: HTMLImageElement; top: number; left: number } | null>(null);
    const hideTimer = useRef<number | undefined>(undefined);
    const close = useCallback(() => setImage(null), []);

    useEffect(() => {
        const root = container.current;
        if (!root) return;
        markImages(root, compact);
        const observer = new MutationObserver(() => markImages(root, compact));
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [compact]);

    const clearHide = () => window.clearTimeout(hideTimer.current);
    const scheduleHide = (delay: number) => {
        clearHide();
        hideTimer.current = window.setTimeout(() => setTrigger(null), delay);
    };
    useEffect(() => () => window.clearTimeout(hideTimer.current), []);
    useEffect(() => {
        if (!trigger) return;
        const hide = () => setTrigger(null);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [trigger]);

    const open = (img: HTMLImageElement) => {
        setTrigger(null);
        setImage(slideFor(img));
    };
    const directImage = (target: EventTarget | null) =>
        target instanceof HTMLImageElement && target.getAttribute('data-zoomable-image') === 'direct' ? target : null;
    const optionImage = (target: EventTarget | null) =>
        target instanceof HTMLImageElement && target.getAttribute('data-zoomable-image') === 'inline' ? target : null;

    return <div ref={container} className={`${compact ? 'result-image-preview ' : ''}${className}`}
        onClick={event => {
            const img = directImage(event.target);
            if (img) open(img);
        }}
        onKeyDown={event => {
            const img = directImage(event.target);
            if (img && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                open(img);
            }
        }}
        onPointerOver={event => {
            const img = optionImage(event.target);
            if (!img) return;
            const rect = img.getBoundingClientRect();
            if (rect.width < 24 || rect.height < 24) return;
            clearHide();
            setTrigger({ img, top: rect.top + 6, left: Math.max(4, rect.right - 38) });
            // Touch has no hover-out: keep the button briefly after the tap.
            if (event.pointerType === 'touch') scheduleHide(3000);
        }}
        onPointerOut={event => {
            if (optionImage(event.target) && event.pointerType !== 'touch') scheduleHide(300);
        }}>
        {children}
        {trigger && typeof document !== 'undefined' && createPortal(
            <button type="button" className="cbt-image-zoom-trigger" style={{ top: trigger.top, left: trigger.left }}
                aria-label="Perbesar gambar" title="Perbesar gambar"
                onPointerEnter={clearHide}
                onPointerLeave={() => scheduleHide(200)}
                onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    open(trigger.img);
                }}>
                <ZoomIn size={16} strokeWidth={2.5} />
            </button>,
            document.body,
        )}
        <ImageZoomViewer image={image} onClose={close} />
    </div>;
}
