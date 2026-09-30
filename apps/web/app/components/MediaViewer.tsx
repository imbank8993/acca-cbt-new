'use client';

import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, X, ZoomIn } from 'lucide-react';
import React, { useState } from 'react';
import { resolveStorageUrl, normalizeHtmlStorageUrls } from '@/lib/safe-url';

interface MediaViewerProps {
    src: string;
    type: 'image' | 'video';
    alt?: string;
    className?: string;
}

export function MediaViewer({ src, type, alt = '', className = '' }: MediaViewerProps) {
    const safeSrc = resolveStorageUrl(src);
    const [isOpen, setIsOpen] = useState(false);
    const [, setIsPlaying] = useState(true);

    if (type === 'image') {
        return (
            <>
                <div className={`relative inline-block cursor-zoom-in group ${className}`} onClick={() => setIsOpen(true)}>
                    <Image
                        src={safeSrc}
                        alt={alt}
                        width={1600}
                        height={900}
                        unoptimized
                        className="max-w-full h-auto rounded-lg border border-slate-200 hover:opacity-90 transition-opacity"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg">
                        <ZoomIn className="w-6 h-6 text-white drop-shadow-lg" />
                    </div>
                </div>

                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
                            onClick={() => setIsOpen(false)}
                        >
                            <button
                                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <X size={24} />
                            </button>
                            <motion.img
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                src={safeSrc}
                                alt={alt}
                                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </>
        );
    }

    // Video
    return (
        <>
            <div className={`relative inline-block group ${className}`}>
                <video
                    src={safeSrc}
                    controls
                    className="max-w-full h-auto rounded-lg border border-slate-200"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                />
                <button
                    className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors"
                    onClick={() => setIsOpen(true)}
                >
                    <Maximize2 size={16} />
                </button>
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-black flex items-center justify-center p-4"
                        onClick={() => setIsOpen(false)}
                    >
                        <button
                            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-10"
                            onClick={() => setIsOpen(false)}
                        >
                            <X size={24} />
                        </button>
                        <video
                            src={safeSrc}
                            controls
                            autoPlay
                            className="max-w-full max-h-full object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}

// Helper to render media from HTML content
export function parseMediaContent(html: string): React.ReactNode[] {
    const result: React.ReactNode[] = [];
    const normalizedHtml = normalizeHtmlStorageUrls(html || '');

    // Parse images
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi;
    const processedHtml = normalizedHtml.replace(imgRegex, (match, src, alt) => {
        result.push(
            <MediaViewer key={`img-${result.length}`} src={resolveStorageUrl(src)} alt={alt} type="image" className="my-2" />
        );
        return '';
    });

    // Parse videos
    const videoRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const processedHtml2 = processedHtml.replace(videoRegex, (match, src) => {
        result.push(
            <MediaViewer key={`video-${result.length}`} src={resolveStorageUrl(src)} type="video" className="my-2" />
        );
        return '';
    });

    // Return parsed content plus remaining HTML
    if (processedHtml2.trim()) {
        result.push(<span key="text" dangerouslySetInnerHTML={{ __html: processedHtml2 }} />);
    }

    return result;
}
