'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

interface PDFContentProps {
    blobUrl: string;
}

export default function PDFContent({ blobUrl }: PDFContentProps) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [scale, setScale] = useState(() =>
        typeof window !== 'undefined' && window.innerWidth < 768 ? 0.75 : 1.0
    );

    const zoomIn = () => setScale(s => Math.min(2.5, s + 0.2));
    const zoomOut = () => setScale(s => Math.max(0.4, s - 0.2));
    const zoomReset = () => setScale(typeof window !== 'undefined' && window.innerWidth < 768 ? 0.75 : 1.0);

    return (
        <div className="flex flex-col h-full bg-[#1a1d27]">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#0f1117] border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2.5">
                    <i className="bi bi-file-earmark-pdf text-red-400 text-lg" />
                    <div>
                        <span className="text-sm font-medium text-white/80">
                            {numPages ? `${numPages} halaman` : 'Memuat...'}
                        </span>
                        <span className="text-[11px] text-white/30 ml-2">Scroll untuk navigasi</span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={zoomOut}
                        disabled={scale <= 0.4}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white/70 hover:text-white transition-colors"
                        title="Perkecil"
                    >
                        <i className="bi bi-dash-lg text-sm" />
                    </button>

                    <span className="text-xs font-semibold text-white/80 min-w-[48px] text-center bg-white/5 rounded-lg px-2.5 py-1.5">
                        {Math.round(scale * 100)}%
                    </span>

                    <button
                        onClick={zoomIn}
                        disabled={scale >= 2.5}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white/70 hover:text-white transition-colors"
                        title="Perbesar"
                    >
                        <i className="bi bi-plus-lg text-sm" />
                    </button>

                    <button
                        onClick={zoomReset}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                        title="Reset zoom"
                    >
                        <i className="bi bi-arrow-counterclockwise text-sm" />
                    </button>
                </div>
            </div>

            {/* Pages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center gap-4 bg-[#1a1d27]">
                <Document
                    file={blobUrl}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={
                        <div className="flex flex-col items-center justify-center gap-4 py-20 text-white/50">
                            <div className="w-10 h-10 border-2 border-white/10 border-t-white/60 rounded-full animate-spin" />
                            <span className="text-sm">Memuat PDF...</span>
                        </div>
                    }
                    error={
                        <div className="flex flex-col items-center justify-center gap-3 py-20 text-red-400">
                            <i className="bi bi-exclamation-triangle text-3xl" />
                            <p className="text-sm m-0">Gagal memuat PDF</p>
                        </div>
                    }
                >
                    {Array.from(new Array(numPages || 0), (_, i) => (
                        <div
                            key={`page-${i + 1}`}
                            className="bg-white rounded-lg shadow-lg overflow-hidden mb-2 w-full max-w-[900px]"
                        >
                            <Page
                                pageNumber={i + 1}
                                scale={scale}
                                renderTextLayer
                                renderAnnotationLayer
                            />
                        </div>
                    ))}
                </Document>
            </div>
        </div>
    );
}
