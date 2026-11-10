"use client";

import type { ReactNode } from 'react';
import { ZoomableImages } from './ZoomableImages';
import './result-image-preview.css';

/** Keep review diagrams compact; the zoom viewer always uses the original image. */
export function ResultImagePreview({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <ZoomableImages compact className={className}>{children}</ZoomableImages>;
}
