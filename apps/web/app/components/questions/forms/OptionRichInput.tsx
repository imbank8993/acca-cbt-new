"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Mic, Video, Link as LinkIcon, Sigma, Table as TableIcon, Plus } from 'lucide-react';
import TipTapEditorCore, { type TipTapEditorControls, type OptionInsertAction } from '../TipTapEditorCore';
import '../question-editor-dark.css';

export function useOptionInsertMenu() {
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    const editorControls = useRef<TipTapEditorControls>(null);
    const insertTriggerRef = useRef<HTMLButtonElement | null>(null);
    const insertMenuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 216, upward: false });

    const updateMenuPosition = useCallback(() => {
        const trigger = insertTriggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(216, window.innerWidth - 16);
        const below = window.innerHeight - rect.bottom;
        const upward = below < 140 && rect.top > below;
        setMenuPosition({
            top: upward ? rect.top - 8 : rect.bottom + 8,
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            width,
            upward,
        });
    }, []);

    const toggleInsertMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        insertTriggerRef.current = event.currentTarget;
        updateMenuPosition();
        setShowToolsMenu(open => !open);
    };

    // Menutup menu saat klik di luar
    useEffect(() => {
        if (!showToolsMenu) return;
        const handleClickOutside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!insertMenuRef.current?.contains(target) && !insertTriggerRef.current?.contains(target)) setShowToolsMenu(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowToolsMenu(false); };
        const handleViewportChange = (event: Event) => {
            if (event.target instanceof Node && insertMenuRef.current?.contains(event.target)) return;
            updateMenuPosition();
        };
        document.addEventListener('pointerdown', handleClickOutside, true);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleViewportChange, true);
        window.addEventListener('resize', handleViewportChange);
        return () => {
            document.removeEventListener('pointerdown', handleClickOutside, true);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleViewportChange, true);
            window.removeEventListener('resize', handleViewportChange);
        };
    }, [showToolsMenu, updateMenuPosition]);

    const insertTools = (
        <div className="option-insert-menu grid grid-cols-3 gap-1 p-1.5 rounded-xl border border-slate-200 shadow-xl bg-white"
            role="group" aria-label="Sisipkan ke opsi jawaban" onClick={event => event.stopPropagation()}>
            {([
                ['image', 'Gambar', ImageIcon], ['math', 'Rumus', Sigma], ['table', 'Tabel', TableIcon],
                ['audio', 'Audio', Mic], ['video', 'Video', Video], ['link', 'Tautan', LinkIcon],
            ] as const).map(([action, label, Icon]) => <button key={action} type="button" title={`Sisipkan ${label}`} aria-label={`Sisipkan ${label}`}
                className="option-insert-action flex flex-col items-center justify-center gap-1 min-w-14 min-h-12 px-2 py-1.5 rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                onMouseDown={event => event.preventDefault()}
                onClick={() => { editorControls.current?.openInsert(action as OptionInsertAction); setShowToolsMenu(false); }}>
                <Icon size={16} /><span className="text-[10px] font-medium">{label}</span>
            </button>)}
        </div>
    );

    const menu = showToolsMenu && typeof document !== 'undefined' && createPortal(
                <div ref={insertMenuRef} className="option-insert-popover" style={{
                    top: menuPosition.top,
                    left: menuPosition.left,
                    width: menuPosition.width,
                    transform: menuPosition.upward ? 'translateY(-100%)' : undefined,
                }}>{insertTools}</div>, document.body,
            );
    return { editorControls, showToolsMenu, toggleInsertMenu, menu };
}

export function OptionRichInput({ value, onChange, placeholder = '', onFocus, onBlur, className = '' }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    onFocus?: () => void;
    onBlur?: () => void;
    className?: string;
}) {
    const { editorControls, showToolsMenu, toggleInsertMenu, menu } = useOptionInsertMenu();
    return <div className={`flex items-center w-full min-w-0 ${className}`} onFocusCapture={onFocus} onBlurCapture={onBlur}>
        <div className="flex-1 min-w-0">
            <TipTapEditorCore compact controlsRef={editorControls} content={value} onChange={onChange} placeholder={placeholder} minHeight="28px" />
        </div>
        <button type="button" onClick={toggleInsertMenu} aria-expanded={showToolsMenu}
            aria-label="Sisipkan media / rumus" title="Sisipkan media / rumus"
            className={`shrink-0 w-7 h-7 mx-1 flex items-center justify-center rounded-md transition-colors ${showToolsMenu ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800'}`}>
            <Plus size={14} className={showToolsMenu ? 'rotate-45' : ''} />
        </button>
        {menu}
    </div>;
}
