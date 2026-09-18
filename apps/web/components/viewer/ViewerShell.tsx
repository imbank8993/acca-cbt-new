'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { FileType } from './types';
import { getFileIcon, getFileColor } from './types';

interface ViewerShellProps {
    title: string;
    fileType: FileType;
    onClose: () => void;
    children: React.ReactNode;
    /** Optional: URL for opening in new tab */
    fileUrl?: string;
    /** Optional: Blob URL for downloading */
    blobUrl?: string | null;
    /** Loading state */
    loading?: boolean;
    /** Error state */
    error?: string;
    /** Progress message during loading */
    progress?: string;
    /** Callback for retry */
    onRetry?: () => void;
    /** Extra header actions */
    headerActions?: React.ReactNode;
    /** Hide footer hint */
    hideFooter?: boolean;
    /** Custom footer content */
    footerContent?: React.ReactNode;
}

export default function ViewerShell({
    title,
    fileType,
    onClose,
    children,
    fileUrl,
    blobUrl,
    loading,
    error,
    progress = 'Memuat...',
    onRetry,
    headerActions,
    hideFooter,
    footerContent,
}: ViewerShellProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    if (!mounted) return null;

    const icon = getFileIcon(fileType);
    const color = getFileColor(fileType);
    const fileLabel: Record<FileType, string> = {
        pdf: 'PDF Document',
        image: 'Image',
        video: 'Video',
        audio: 'Audio',
        excel: 'Spreadsheet',
        word: 'Word Document',
        ppt: 'Presentation',
        unknown: 'File',
    };

    const handleDownload = () => {
        const a = document.createElement('a');
        a.href = blobUrl || fileUrl || '';
        a.download = title || 'dokumen';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="fixed inset-0 z-[99990] bg-black/80 backdrop-blur-sm"
            />

            {/* Modal */}
            <div className="fixed inset-0 z-[99999] flex flex-col bg-[#0f1117] animate-[viewerIn_0.25s_ease-out]">
                {/* ── Header ── */}
                <header className="flex items-center justify-between px-4 py-3 bg-[#181b24] border-b border-white/5 shrink-0 select-none">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                            style={{ background: `${color}22`, color }}
                        >
                            <i className={`bi ${icon}`} />
                        </div>
                        <div className="min-w-0 overflow-hidden">
                            <h2 className="text-sm font-semibold text-white truncate m-0">
                                {title}
                            </h2>
                            <p className="text-[11px] text-white/40 truncate m-0">
                                {loading
                                    ? progress
                                    : error
                                        ? 'Gagal memuat'
                                        : fileLabel[fileType]}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        {headerActions}

                        {fileUrl && (
                            <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white no-underline"
                                title="Buka di tab baru"
                            >
                                <i className="bi bi-box-arrow-up-right text-sm" />
                            </a>
                        )}

                        {(blobUrl || fileUrl) && (
                            <button
                                onClick={handleDownload}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                                title="Download"
                            >
                                <i className="bi bi-download text-sm" />
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 transition-colors text-white/50 hover:text-white"
                            title="Tutup (ESC)"
                        >
                            <i className="bi bi-x-lg text-sm" />
                        </button>
                    </div>
                </header>

                {/* ── Content ── */}
                <div className="flex-1 overflow-hidden relative">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/60">
                            <div className="w-9 h-9 border-2 border-white/10 border-t-white/60 rounded-full animate-spin" />
                            <span className="text-sm font-medium">{progress}</span>
                        </div>
                    )}

                    {error && !loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-8">
                            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
                                <i className="bi bi-exclamation-triangle text-2xl text-red-400" />
                            </div>
                            <div>
                                <p className="text-red-400 text-sm font-medium m-0">{error}</p>
                                <p className="text-white/30 text-xs mt-1 m-0">Gagal memuat dokumen</p>
                            </div>
                            {onRetry && (
                                <button
                                    onClick={onRetry}
                                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-colors"
                                >
                                    <i className="bi bi-arrow-clockwise mr-2" />
                                    Coba Lagi
                                </button>
                            )}
                            {(blobUrl || fileUrl) && (
                                <button
                                    onClick={handleDownload}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
                                >
                                    <i className="bi bi-download mr-2" />
                                    Download File
                                </button>
                            )}
                        </div>
                    )}

                    {!loading && !error && children}
                </div>

                {/* ── Footer ── */}
                {!hideFooter && !loading && !error && (
                    <footer className="shrink-0">
                        {footerContent || (
                            <div className="flex items-center justify-center py-2.5 bg-[#181b24] border-t border-white/5">
                                <span className="text-[11px] text-white/30">
                                    Tekan <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[10px] font-mono mx-0.5">ESC</kbd> untuk menutup
                                </span>
                            </div>
                        )}
                    </footer>
                )}
            </div>

            <style>{`
                @keyframes viewerIn {
                    from { opacity: 0; transform: scale(0.97); }
                    to { opacity: 1; transform: scale(1); }
                }
                button:active { transform: scale(0.92) !important; }
            `}</style>
        </>,
        document.body
    );
}
