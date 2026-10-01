'use client';

import Image from 'next/image';
import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { resolveStorageUrl } from '@/lib/safe-url';

interface QuestionBankCoverProps {
    imageUrl?: string | null;
    title: string;
    width: number;
    height: number;
    className?: string;
    iconSize?: number;
}

export function QuestionBankCover({
    imageUrl,
    title,
    width,
    height,
    className = 'w-full h-full object-cover',
    iconSize = 20,
}: QuestionBankCoverProps) {
    const src = resolveStorageUrl(imageUrl || '');
    const [failedSrc, setFailedSrc] = useState('');

    if (!src || failedSrc === src) {
        return <BookOpen size={iconSize} className="text-[#3083FF]" aria-label={`Cover ${title} tidak tersedia`} />;
    }

    return (
        <Image
            src={src}
            alt={title}
            width={width}
            height={height}
            unoptimized
            className={className}
            onError={() => setFailedSrc(src)}
        />
    );
}
