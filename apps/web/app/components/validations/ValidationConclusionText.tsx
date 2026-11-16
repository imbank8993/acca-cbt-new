import React from 'react';
import { splitGeneralComment } from '@/lib/validation-conclusion';

/** Kesimpulan akhir validator: kesimpulan dan saran umum ditampilkan terpisah. */
export function ValidationConclusionText({ text, className = '' }: { text?: string | null; className?: string }) {
    const { conclusion, suggestion } = splitGeneralComment(text);
    if (!conclusion && !suggestion) return null;
    return (
        <div className={`space-y-1 whitespace-pre-wrap ${className}`}>
            {conclusion && <p><span className="font-bold not-italic">Kesimpulan:</span> {conclusion}</p>}
            {suggestion && <p><span className="font-bold not-italic">Saran umum:</span> {suggestion}</p>}
        </div>
    );
}
