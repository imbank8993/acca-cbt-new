"use client";
/**
 * AnswerOptionCard — Elegant MCQ option editor with insert toolbar.
 */
import { Check,Minus,Plus,Trash2,Upload } from 'lucide-react';
import type { MathfieldElement } from 'mathlive';
import React,{ useEffect,useMemo,useState } from 'react';
import { useOptionInsertMenu } from './OptionRichInput';
import { MathToolbar } from '../MathToolbar';
import { renderLatex,sanitizeLatex } from '../math-utils';
import TipTapEditorCore from '../TipTapEditorCore';

// ─── Equation Dialog (with MathToolbar) ────────────────────────────────────

interface EquationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onInsert: (latex: string) => void;
}

export function EquationDialog({ isOpen, onClose, onInsert }: EquationDialogProps) {
    const [input, setInput] = useState('');
    const [editorMode, setEditorMode] = useState<'visual' | 'latex'>('visual');

    useEffect(() => {
        // Dynamic import to register <math-field> without breaking SSR
        import('mathlive').catch((err) => console.error('Failed to load mathlive', err));
    }, []);

    const previewHtml = useMemo(() => {
        if (!input.trim()) return '';
        const result = renderLatex(sanitizeLatex(input), false);
        return result.error ? '' : result.html;
    }, [input]);

    const handleInsert = () => {
        if (input.trim()) {
            onInsert(input.trim());
            setInput('');
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Title */}
                <div className="px-6 pt-5 pb-0 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5">
                                <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-slate-800">Sisipkan Rumus</h3>
                            <p className="text-[10px] text-slate-400">Klik template atau ketik langsung</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                {/* Editor Mode Toggle */}
                <div className="px-6 pt-4">
                    <div className="flex gap-2 mb-2">
                        <button onClick={() => setEditorMode('visual')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${editorMode === 'visual' ? 'bg-[#3083FF] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Visual (Word)</button>
                        <button onClick={() => setEditorMode('latex')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${editorMode === 'latex' ? 'bg-[#3083FF] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Kode LaTeX</button>
                    </div>
                </div>

                {/* Input */}
                <div className="px-6 pt-2">
                    {editorMode === 'visual' ? (
                        <div className="w-full min-h-[80px] p-2.5 border border-slate-200 rounded-lg outline-none focus-within:border-slate-400 bg-white">
                            <style>{`
                              math-field::part(menu-toggle) { display: none !important; }
                              math-field::part(virtual-keyboard-toggle) { display: none !important; }
                              math-field {
                                --placeholder-color: #cbd5e1;
                                --placeholder-opacity: 0.6;
                              }
                            `}</style>
                            <math-field 
                                id="mf-option-editor"
                                style={{ width: '100%', minHeight: '80px', fontSize: '1.25rem', padding: '12px', outline: 'none' }}
                                onInput={(e) => {
                                    let val = e.currentTarget.value;
                                    const originalVal = val;
                                    // Force placeholders for extensible accents that natively drop them when empty
                                    val = val.replace(/\\overrightarrow\{\}/g, '\\overrightarrow{\\placeholder{}}')
                                             .replace(/\\widehat\{\}/g, '\\widehat{\\placeholder{}}')
                                             .replace(/\\overline\{\}/g, '\\overline{\\placeholder{}}')
                                             .replace(/\\wideparen\{\}/g, '\\wideparen{\\placeholder{}}')
                                             .replace(/\\underline\{\}/g, '\\underline{\\placeholder{}}');
                                    
                                    if (val !== originalVal) {
                                      e.currentTarget.value = val;
                                      e.currentTarget.executeCommand(['moveToNextPlaceholder']);
                                    }
                                    setInput(val);
                                }}
                                ref={(el: MathfieldElement | null) => {
                                  if (el && el.value !== input) {
                                    el.value = input;
                                  }
                                }}
                            >
                            </math-field>
                        </div>
                    ) : (
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ketik rumus LaTeX, contoh: \frac{a}{b}"
                            rows={3}
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInsert(); }
                            }}
                        />
                    )}
                </div>

                {/* Live Preview for LaTeX mode */}
                {editorMode === 'latex' && previewHtml && (
                    <div className="px-6 pt-2">
                        <p className="text-[10px] font-medium text-slate-400 mb-1">Pratinjau:</p>
                        <div className="bg-slate-50 rounded-lg px-4 py-3 text-center">
                            <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                    </div>
                )}

                {/* MathToolbar */}
                <div className="px-6 pt-3 pb-2">
                    <p className="text-[11px] font-medium text-slate-400 mb-2">Template</p>
                    <MathToolbar
                        onInsert={(template) => {
                            if (editorMode === 'visual') {
                                const mf = document.getElementById('mf-option-editor') as MathfieldElement | null;
                                if (mf) {
                                    const liveLatex = template.replace(/\?/g, '#?');
                                    mf.executeCommand(['insert', liveLatex]);
                                    setInput(mf.value);
                                }
                            } else {
                                const plainLatex = template.replace(/\?/g, ' ');
                                const ta = document.querySelector('textarea[placeholder="Ketik rumus LaTeX, contoh: \\frac{a}{b}"]') as HTMLTextAreaElement;
                                if (ta) {
                                    const pos = ta.selectionStart;
                                    const newVal = input.slice(0, pos) + plainLatex + input.slice(pos);
                                    setInput(newVal);
                                    const firstPlaceholderIdx = plainLatex.indexOf(' ');
                                    const jumpPos = firstPlaceholderIdx !== -1 ? pos + firstPlaceholderIdx : pos + plainLatex.length;
                                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = jumpPos; ta.focus(); }, 0);
                                } else {
                                    setInput(prev => prev + plainLatex);
                                }
                            }
                        }}
                        visible={true}
                        className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto"
                    />
                </div>

                {/* Footer */}
                <div className="px-6 py-4 flex justify-end gap-2 border-t border-slate-100 mt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg transition-colors">
                        Batal
                    </button>
                    <button onClick={handleInsert} disabled={!input.trim()}
                        className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#020735] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm">
                        Sisipkan
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Table Dialog ─────────────────────────────────────────────────────────────

interface TableDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onInsert: (rows: number, cols: number) => void;
}

export function TableDialog({ isOpen, onClose, onInsert }: TableDialogProps) {
    const [rows, setRows] = useState(2);
    const [cols, setCols] = useState(2);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Title */}
                <div className="px-6 pt-5 pb-0 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-800">Sisipkan Tabel</h3>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                {/* Preview */}
                <div className="px-6 pt-4">
                    <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-center">
                        <table style={{ borderCollapse: 'collapse' }}>
                            <tbody>
                                {Array.from({ length: Math.min(rows, 4) }).map((_, r) => (
                                    <tr key={r}>
                                        {Array.from({ length: Math.min(cols, 5) }).map((_, c) => (
                                            <td key={c} style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>
                                                <span className="text-[10px] text-slate-400">{r + 1},{c + 1}</span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Controls - Side by side */}
                <div className="px-6 pt-4 pb-2">
                    <div className="flex gap-4">
                        {/* Rows */}
                        <div className="flex-1">
                            <label className="text-[11px] font-medium text-slate-400 block mb-2">Baris</label>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setRows(Math.max(1, rows - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                    <Minus size={14} />
                                </button>
                                <div className="flex-1 text-center text-lg font-semibold text-slate-800">{rows}</div>
                                <button onClick={() => setRows(Math.min(10, rows + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Columns */}
                        <div className="flex-1">
                            <label className="text-[11px] font-medium text-slate-400 block mb-2">Kolom</label>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setCols(Math.max(1, cols - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                    <Minus size={14} />
                                </button>
                                <div className="flex-1 text-center text-lg font-semibold text-slate-800">{cols}</div>
                                <button onClick={() => setCols(Math.min(10, cols + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg transition-colors">
                        Batal
                    </button>
                    <button onClick={() => { onInsert(rows, cols); onClose(); }}
                        className="px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-hover transition-all">
                        Sisipkan
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── BulkAddModal ─────────────────────────────────────────────────────────────

interface BulkAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (lines: string[]) => void;
    title?: string;
    placeholder?: string;
}

export function BulkAddModal({ isOpen, onClose, onAdd, title = "Tambah Banyak Opsi", placeholder = "Ketik atau tempel beberapa opsi di sini...\nGunakan baris baru untuk memisahkan opsi." }: BulkAddModalProps) {
    const [text, setText] = useState('');

    if (!isOpen) return null;

    const handleAdd = () => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
            onAdd(lines);
            setText('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 pt-5 pb-0 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                            <Plus size={16} strokeWidth={3} />
                        </div>
                        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="p-6">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={placeholder}
                        rows={8}
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none font-medium"
                        autoFocus
                    />
                    <div className="mt-4 flex justify-end gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">
                            Batal
                        </button>
                        <button onClick={handleAdd} disabled={!text.trim()}
                            className="px-6 py-2 text-sm font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-all shadow-lg shadow-slate-800/10">
                            Tambah {text.split('\n').filter(l => l.trim()).length || ''} Opsi
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── AnswerOptionCard ──────────────────────────────────────────────────────────

interface AnswerOptionCardProps {
    label: string;
    value: string;
    isCorrect?: boolean;
    isMultiSelect?: boolean;
    onChange: (text: string) => void;
    onCorrectToggle?: () => void;
    onDelete?: () => void;
    placeholder?: string;
    canDelete?: boolean;
    className?: string;
    hideCorrectToggle?: boolean;
    hideRichTools?: boolean;
}

export const AnswerOptionCard = React.memo(({
    label,
    value,
    isCorrect = false,
    isMultiSelect = false,
    onChange,
    onCorrectToggle = () => {},
    onDelete,
    placeholder = 'Ketik jawaban...',
    canDelete = true,
    className = '',
    hideCorrectToggle = false,
    hideRichTools = false,
}: AnswerOptionCardProps) => {
    const [isFocused, setIsFocused] = useState(false);
    const { editorControls, showToolsMenu, toggleInsertMenu, menu } = useOptionInsertMenu();

    return (
        <div className={`group relative ${className}`} suppressHydrationWarning>
            {/* Mobile Header Bar (sm:hidden): Badge, Kunci Jawaban Toggle, Tools, Delete */}
            <div className="flex sm:hidden items-center justify-between pb-1.5 px-0.5">
                <div className="flex items-center gap-2">
                    {/* Badge */}
                    <div className={`
                        w-7 h-7 rounded-lg flex items-center justify-center
                        text-xs font-black select-none transition-all
                        ${isCorrect
                            ? 'bg-[#3083FF] text-white shadow-sm'
                            : isFocused
                                ? 'bg-slate-800 text-white'
                                : 'bg-slate-100 text-slate-600'
                        }
                    `}>
                        {label}
                    </div>

                    {/* Mobile Correct Toggle */}
                    {!hideCorrectToggle && (
                        <button
                            type="button"
                            onClick={onCorrectToggle}
                            aria-pressed={isCorrect}
                            aria-label={isCorrect ? `Opsi ${label}: kunci jawaban` : `Jadikan opsi ${label} kunci jawaban`}
                            title={isCorrect ? 'Kunci jawaban' : 'Jadikan kunci jawaban'}
                            className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg border transition-all ${
                                isCorrect
                                    ? 'bg-[#3083FF] border-[#3083FF] text-white shadow-sm shadow-blue-500/20'
                                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600'
                            }`}
                        >
                            <Check size={16} strokeWidth={isCorrect ? 3 : 2} aria-hidden="true" />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1.5">
                    {/* Mobile Insert Tools (+ menu) */}
                    {!hideRichTools && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={toggleInsertMenu}
                                aria-expanded={showToolsMenu}
                                className={`w-8 h-8 flex items-center justify-center rounded-lg border text-xs transition-all ${
                                    showToolsMenu ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                                title="Sisipkan media / rumus"
                            >
                                <Plus size={14} className={`transition-transform duration-200 ${showToolsMenu ? 'rotate-45' : ''}`} />
                            </button>


                        </div>
                    )}

                    {/* Mobile Delete Button */}
                    {canDelete && onDelete && (
                        <button
                            type="button"
                            onClick={onDelete}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all"
                            title="Hapus Opsi"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Main Row / Card (Desktop & Mobile input) */}
            <div className={`flex items-start sm:items-center gap-1.5 sm:gap-2`}>
                {/* Desktop Letter Badge */}
                <div className={`
                    hidden sm:flex mt-1 sm:mt-0 shrink-0 items-center justify-center
                    w-8 h-8 rounded-lg
                    text-sm font-black select-none
                    transition-all duration-200
                    ${isCorrect
                        ? 'bg-[#3083FF] text-white'
                        : isFocused
                            ? 'bg-slate-800 text-white'
                            : 'bg-slate-100 text-slate-500'
                    }
                `}>
                    {label}
                </div>

                {/* Input Card (Takes 100% width on mobile) */}
                <div className={`
                    flex-1 flex flex-col sm:flex-row items-stretch sm:items-center
                    rounded-lg border-2 transition-all duration-200 w-full min-w-0
                    ${isFocused
                        ? 'border-slate-800 bg-white shadow-sm'
                        : isCorrect
                            ? 'border-blue-300 bg-blue-50/50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                    }
                `}>
                    {/* Text Input Wrapper */}
                    <div className="flex flex-1 min-w-0">
                        <div className="flex-1 min-w-0" onFocusCapture={() => setIsFocused(true)} onBlurCapture={() => setIsFocused(false)}>
                            <TipTapEditorCore compact controlsRef={editorControls} content={value} onChange={onChange}
                                placeholder={placeholder} minHeight="32px" />
                        </div>
                    </div>

                    {/* Desktop Toolbar - Inside card */}
                    {!hideRichTools && (
                    <div className="hidden sm:flex relative shrink-0 px-2 items-center justify-end sm:justify-start">
                        {/* Toggle Button */}
                        <button
                            type="button"
                            onClick={toggleInsertMenu}
                            aria-expanded={showToolsMenu}
                            className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${showToolsMenu ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                            title="Sisipkan media / rumus"
                        >
                            <Plus size={14} className={`transition-transform duration-200 ${showToolsMenu ? 'rotate-45' : ''}`} />
                        </button>


                    </div>
                    )}
                </div>

                {/* Desktop Correct toggle */}
                {!hideCorrectToggle && (
                    <button
                        type="button"
                        onClick={onCorrectToggle}
                        title={isMultiSelect ? 'Pilih sebagai jawaban benar' : 'Tetapkan sebagai jawaban benar'}
                        className={`
                            hidden sm:flex mt-1 sm:mt-0 shrink-0 items-center justify-center
                            w-8 h-8 rounded-lg border-2
                            transition-all duration-200
                            ${isCorrect
                                ? 'bg-[#3083FF] border-blue-500 text-white'
                                : 'border-slate-200 text-transparent group-hover:border-blue-400 group-hover:text-blue-500'
                            }
                        `}
                    >
                        <Check size={14} strokeWidth={3} />
                    </button>
                )}

                {/* Desktop Delete button */}
                {canDelete && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        className={`
                            hidden sm:flex mt-1 sm:mt-0 shrink-0 items-center justify-center
                            w-8 h-8 rounded-lg
                            transition-all duration-200
                            text-slate-400 hover:text-rose-500 hover:bg-rose-50
                            ${isFocused || isCorrect ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}
                        `}
                        title="Hapus Opsi"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {menu}
        </div>
    );
});

AnswerOptionCard.displayName = 'AnswerOptionCard';

// ─── OptionList ────────────────────────────────────────────────────────────────

interface OptionListProps {
    children: React.ReactNode;
    onAdd?: () => void;
    onBulkAdd?: (lines: string[]) => void;
    addLabel?: string;
    maxItems?: number;
    className?: string;
}

export const OptionList = React.memo(({
    children,
    onAdd,
    onBulkAdd,
    addLabel = 'Tambah Opsi',
    maxItems,
    className = '',
}: OptionListProps) => {
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

    return (
        <div className={`space-y-2 ${className}`}>
            {children}
            <div className="flex gap-2">
                {onAdd && (
                    <button type="button" onClick={onAdd} disabled={!!maxItems && React.Children.count(children) >= maxItems}
                        className={`
                            flex-1 flex items-center justify-center gap-2 py-2.5
                            text-xs font-semibold rounded-lg border-2 border-dashed
                            transition-all duration-200
                            ${(!!maxItems && React.Children.count(children) >= maxItems)
                                ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-400'
                                : 'border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }
                        `}>
                        <Plus size={14} />
                        {addLabel}
                    </button>
                )}
                {onBulkAdd && (
                    <button type="button" onClick={() => setIsBulkModalOpen(true)}
                        className="px-4 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-lg border-2 border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
                        <Upload size={14} />
                        Banyak
                    </button>
                )}
            </div>

            {onBulkAdd && (
                <BulkAddModal
                    isOpen={isBulkModalOpen}
                    onClose={() => setIsBulkModalOpen(false)}
                    onAdd={onBulkAdd}
                    title={`Tambah ${addLabel} Sekaligus`}
                />
            )}
        </div>
    );
});

OptionList.displayName = 'OptionList';
