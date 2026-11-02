"use client";

import { useEffect, useRef, useState } from 'react';

export function useBankFolderMenu() {
    const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
    const folderMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!folderMenuId) return;
        const closeOutside = (event: Event) => {
            if (event.target instanceof Node && !folderMenuRef.current?.contains(event.target)) {
                setFolderMenuId(null);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                folderMenuRef.current?.querySelector('button')?.focus();
                setFolderMenuId(null);
            }
        };
        document.addEventListener('pointerdown', closeOutside, true);
        document.addEventListener('focusin', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside, true);
            document.removeEventListener('focusin', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [folderMenuId]);

    return { folderMenuId, setFolderMenuId, folderMenuRef };
}
