'use client';

import type { FileType } from './types';

interface OfficeContentProps {
    fileUrl: string;
    fileType: FileType;
    title?: string;
}

export default function OfficeContent({ fileUrl, fileType, title }: OfficeContentProps) {
    const labels: Record<string, string> = {
        word: 'Microsoft Word',
        ppt: 'Microsoft PowerPoint',
        excel: 'Microsoft Excel',
    };

    const icons: Record<string, string> = {
        word: 'bi-file-earmark-word',
        ppt: 'bi-file-earmark-ppt',
        excel: 'bi-file-earmark-excel',
    };

    const colors: Record<string, string> = {
        word: '#2b579a',
        ppt: '#d24726',
        excel: '#16a34a',
    };

    const label = labels[fileType] || 'Dokumen';
    const icon = icons[fileType] || 'bi-file-earmark';
    const color = colors[fileType] || '#6b7280';

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#0f1117] border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2.5">
                    <i className={`${icon} text-lg`} style={{ color }} />
                    <span className="text-sm font-medium text-white/80">{label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium transition-colors no-underline flex items-center gap-1.5"
                    >
                        <i className="bi bi-download text-xs" />
                        <span>Download</span>
                    </a>
                </div>
            </div>

            {/* Viewer */}
            <div className="flex-1 bg-white relative">
                <iframe
                    key={fileUrl}
                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`}
                    className="w-full h-full border-none"
                    title={title || label}
                    loading="lazy"
                />

                {/* Fallback overlay when iframe fails */}
                <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
                    <p className="text-[10px] text-white/50 text-center m-0">
                        <i className="bi bi-info-circle mr-1" />
                        Viewer online memerlukan koneksi internet
                    </p>
                </div>
            </div>
        </div>
    );
}
