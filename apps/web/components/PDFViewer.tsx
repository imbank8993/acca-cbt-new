'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ensureAbsoluteUrl } from '@/utils/url';
import * as XLSX from 'xlsx';

import type { FileType } from './viewer/types';
import { detectFileType } from './viewer/types';
import ViewerShell from './viewer/ViewerShell';
import PDFContent from './viewer/PDFContent';
import ImageContent from './viewer/ImageContent';
import VideoContent from './viewer/VideoContent';
import AudioContent from './viewer/AudioContent';
import ExcelContent from './viewer/ExcelContent';
import OfficeContent from './viewer/OfficeContent';

interface PDFViewerProps {
    url: string;
    title: string;
    onClose: () => void;
}

export default function PDFViewer({ url, title, onClose }: PDFViewerProps) {
    const fileUrl = ensureAbsoluteUrl(url);
    const filename = fileUrl.split('?')[0];
    const fileType: FileType = detectFileType(filename);

    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('Memuat dokumen...');
    const [excelData, setExcelData] = useState<{ sheetName: string; data: any[][] }[]>([]);
    const [useOfficeViewer, setUseOfficeViewer] = useState(false);
    const cancelledRef = useRef(false);

    const needsProxy = fileType === 'pdf' || fileType === 'excel' || fileType === 'word' || fileType === 'ppt' || fileType === 'image';

    // Load blob via proxy
    useEffect(() => {
        if (!needsProxy) return;

        cancelledRef.current = false;
        let objectUrl: string | null = null;

        const load = async () => {
            setLoading(true);
            setError('');
            setProgress('Menghubungi server...');
            try {
                const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(fileUrl)}`;
                setProgress('Mengunduh file...');
                const res = await fetch(proxyUrl);
                if (!res.ok) throw new Error(`Gagal memuat (${res.status})`);
                if (cancelledRef.current) return;
                setProgress('Memproses...');
                const blob = await res.blob();
                if (cancelledRef.current) return;

                objectUrl = URL.createObjectURL(blob);
                setBlobUrl(objectUrl);

                if (fileType === 'excel') {
                    try {
                        const buffer = await blob.arrayBuffer();
                        const workbook = XLSX.read(buffer, { type: 'array' });
                        const allSheets = workbook.SheetNames.map(sheetName => {
                            const worksheet = workbook.Sheets[sheetName];
                            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                            return { sheetName, data: jsonData as any[][] };
                        });
                        setExcelData(allSheets);
                    } catch {
                        setUseOfficeViewer(true);
                    }
                } else if (fileType === 'word' || fileType === 'ppt') {
                    setUseOfficeViewer(true);
                }

                setLoading(false);
            } catch (err: any) {
                if (cancelledRef.current) return;
                setError(err.message || 'Gagal memuat dokumen');
                setLoading(false);
            }
        };

        load();
        return () => {
            cancelledRef.current = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [fileUrl, fileType, needsProxy]);

    const handleRetry = useCallback(() => {
        window.location.reload();
    }, []);

    // ── Render per type ──
    if (fileType === 'image') {
        return (
            <ViewerShell
                title={title}
                fileType="image"
                onClose={onClose}
                fileUrl={fileUrl}
                blobUrl={blobUrl}
                loading={loading}
                error={error}
                progress={progress}
                onRetry={handleRetry}
            >
                <ImageContent src={blobUrl || fileUrl} alt={title} loading={loading} progress={progress} />
            </ViewerShell>
        );
    }

    if (fileType === 'video') {
        return (
            <ViewerShell title={title} fileType="video" onClose={onClose} fileUrl={fileUrl} hideFooter>
                <VideoContent url={fileUrl} />
            </ViewerShell>
        );
    }

    if (fileType === 'audio') {
        return (
            <ViewerShell title={title} fileType="audio" onClose={onClose} fileUrl={fileUrl} hideFooter>
                <AudioContent url={fileUrl} title={title} />
            </ViewerShell>
        );
    }

    if (fileType === 'excel' && excelData.length > 0 && !loading && !error) {
        return (
            <ViewerShell
                title={title}
                fileType="excel"
                onClose={onClose}
                fileUrl={fileUrl}
                blobUrl={blobUrl}
                loading={loading}
                error={error}
                progress={progress}
                onRetry={handleRetry}
            >
                <ExcelContent sheets={excelData} />
            </ViewerShell>
        );
    }

    if ((fileType === 'word' || fileType === 'ppt' || (fileType === 'excel' && useOfficeViewer)) && !loading && !error) {
        return (
            <ViewerShell
                title={title}
                fileType={fileType}
                onClose={onClose}
                fileUrl={fileUrl}
                blobUrl={blobUrl}
            >
                <OfficeContent fileUrl={fileUrl} fileType={fileType} title={title} />
            </ViewerShell>
        );
    }

    // ── PDF / Default ──
    return (
        <ViewerShell
            title={title}
            fileType={fileType === 'pdf' ? 'pdf' : 'unknown'}
            onClose={onClose}
            fileUrl={fileUrl}
            blobUrl={blobUrl}
            loading={loading}
            error={error}
            progress={progress}
            onRetry={handleRetry}
            hideFooter={fileType === 'pdf' && !!blobUrl}
            footerContent={
                fileType === 'pdf' && blobUrl ? (
                    <div className="flex items-center justify-center py-2.5 bg-[#181b24] border-t border-white/5">
                        <span className="text-[11px] text-white/30">
                            Tekan <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[10px] font-mono mx-0.5">ESC</kbd> untuk menutup
                        </span>
                    </div>
                ) : undefined
            }
        >
            {blobUrl && !loading && !error && fileType === 'pdf' && (
                <PDFContent blobUrl={blobUrl} />
            )}
        </ViewerShell>
    );
}