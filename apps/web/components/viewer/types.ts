export interface PDFViewerProps {
    url: string;
    title: string;
    onClose: () => void;
}

export type FileType = 'pdf' | 'image' | 'video' | 'audio' | 'excel' | 'word' | 'ppt' | 'unknown';

export const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|bmp|tiff?|svg)$/i;
export const VIDEO_EXTS = /\.(mp4|webm|ogg|mov)$/i;
export const AUDIO_EXTS = /\.(mp3|wav|ogg|aac|flac|m4a)$/i;
export const EXCEL_EXTS = /\.(xlsx|xls|xlsm)$/i;
export const WORD_EXTS = /\.(doc|docx)$/i;
export const PPT_EXTS = /\.(ppt|pptx)$/i;
export const PDF_EXTS = /\.pdf$/i;

export function detectFileType(filename: string): FileType {
    if (PDF_EXTS.test(filename)) return 'pdf';
    if (IMAGE_EXTS.test(filename)) return 'image';
    if (VIDEO_EXTS.test(filename)) return 'video';
    if (AUDIO_EXTS.test(filename)) return 'audio';
    if (EXCEL_EXTS.test(filename)) return 'excel';
    if (WORD_EXTS.test(filename)) return 'word';
    if (PPT_EXTS.test(filename)) return 'ppt';
    return 'unknown';
}

export function getFileIcon(type: FileType): string {
    const icons: Record<FileType, string> = {
        excel: 'bi-file-earmark-excel-fill',
        word: 'bi-file-earmark-word-fill',
        ppt: 'bi-file-earmark-ppt-fill',
        pdf: 'bi-file-earmark-pdf-fill',
        image: 'bi-file-earmark-image-fill',
        video: 'bi-file-earmark-play-fill',
        audio: 'bi-file-earmark-music-fill',
        unknown: 'bi-file-earmark-fill',
    };
    return icons[type];
}

export function getFileColor(type: FileType): string {
    const colors: Record<FileType, string> = {
        pdf: '#ef4444',
        excel: '#16a34a',
        word: '#2b579a',
        ppt: '#d24726',
        image: '#a855f7',
        video: '#ec4899',
        audio: '#f59e0b',
        unknown: '#6b7280',
    };
    return colors[type];
}
