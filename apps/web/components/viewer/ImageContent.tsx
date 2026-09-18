'use client';

import { useState, useEffect } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Download from 'yet-another-react-lightbox/plugins/download';
import Inline from 'yet-another-react-lightbox/plugins/inline';

import 'yet-another-react-lightbox/styles.css';

interface ImageContentProps {
    src: string;
    alt?: string;
    loading?: boolean;
    progress?: string;
}

export default function ImageContent({ src, alt, loading, progress }: ImageContentProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) {
        return (
            <div className="flex items-center justify-center h-full text-white/40 text-sm">
                {loading ? progress || 'Memuat...' : 'Preparing viewer...'}
            </div>
        );
    }

    return (
        <div className="h-full bg-[#0f1117]">
            <Lightbox
                plugins={[Zoom, Download, Inline]}
                inline={{ style: { width: '100%', height: '100%', background: '#0f1117' } }}
                slides={[{ src, alt: alt || '' }]}
                zoom={{ maxZoomPixelRatio: 5 }}
                styles={{ container: { background: '#0f1117' } }}
            />
        </div>
    );
}
