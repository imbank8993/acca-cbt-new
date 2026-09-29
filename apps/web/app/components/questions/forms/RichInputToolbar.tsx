"use client";
/**
 * RichInputToolbar — Single toolbar shared across all RichInput editors.
 * Place this at the top of the options section.
 * Automatically targets the currently focused RichInput editor.
 */
import { uploadToHosting } from '@/lib/uploader';
import { motion } from 'framer-motion';
import React,{ createContext,useCallback,useContext,useRef,useState } from 'react';

// ─── Context ────────────────────────────────────────────────────────────────

interface RichInputToolbarContextValue {
    activeQuill: React.MutableRefObject<QuillEditor | null>;
    registerFocus: (quill: QuillEditor) => void;
}

interface QuillEditor {
    clipboard: {
        dangerouslyPasteHTML: (index: number, html: string) => void;
    };
    format: (format: string, value: unknown) => void;
    getFormat: () => Record<string, unknown>;
    getSelection: (focus?: boolean) => { index: number; length: number };
    insertText: (index: number, text: string) => void;
}

export const RichInputToolbarContext = createContext<RichInputToolbarContextValue | null>(null);

export function useRichInputToolbar(): RichInputToolbarContextValue | null {
    return useContext(RichInputToolbarContext);
}

// ─── Provider ──────────────────────────────────────────────────────────────

interface RichInputToolbarProviderProps {
    children: React.ReactNode;
}

export function RichInputToolbarProvider({ children }: RichInputToolbarProviderProps) {
    const activeQuill = useRef<QuillEditor | null>(null);

    const registerFocus = useCallback((quill: QuillEditor) => {
        activeQuill.current = quill;
    }, []);

    return (
        <RichInputToolbarContext.Provider value={{ activeQuill, registerFocus }}>
            <div suppressHydrationWarning>{children}</div>
        </RichInputToolbarContext.Provider>
    );
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface SharedToolbarProps {
    className?: string;
}

export const SharedToolbar = React.memo(({ className = '' }: SharedToolbarProps) => {
    const ctx = useRichInputToolbar();
    const activeQuill = ctx?.activeQuill;

    // Table dialog state
    const [tableDialogOpen, setTableDialogOpen] = useState(false);
    const [tableRows, setTableRows] = useState(2);
    const [tableCols, setTableCols] = useState(2);

    // Image upload state
    const [imageUploading, setImageUploading] = useState(false);

    const formatAction = (format: string, value?: unknown) => {
        const q = activeQuill?.current;
        if (!q) return;
        if (value !== undefined) {
            q.format(format, value);
        } else {
            const current = q.getFormat()[format];
            q.format(format, current ? false : true);
        }
    };

    const handleAlign = (align: string) => {
        const q = activeQuill?.current;
        if (!q) return;
        q.format('align', align);
    };

    const handleList = (list: 'ordered' | 'bullet') => {
        const q = activeQuill?.current;
        if (!q) return;
        q.format('list', list);
    };

    const handleLink = () => {
        const q = activeQuill?.current;
        if (!q) return;
        const url = prompt('URL:');
        if (url) {
            q.format('link', url);
        }
    };

    const handleImageFile = async (file: File) => {
        const q = activeQuill?.current;
        if (!q) return;
        setImageUploading(true);
        try {
            const res = await uploadToHosting(file, 'questions');
            const url = res.success ? res.url : '';
            if (url) {
                const range = q.getSelection(true);
                const imgHtml = `<img src="${url}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:4px 0;" />`;
                q.clipboard.dangerouslyPasteHTML(range.index, imgHtml);
            }
        } catch (err) {
            console.error('Image upload failed:', err);
        } finally {
            setImageUploading(false);
        }
    };

    const handleInsertLatex = () => {
        const q = activeQuill?.current;
        if (!q) return;
        const latex = prompt('Ketik rumus LaTeX (tanpa $):', '');
        if (latex !== null && latex.trim()) {
            const range = q.getSelection(true);
            q.insertText(range.index, `$${latex.trim()}$`);
        }
    };

    const insertTable = () => {
        const q = activeQuill?.current;
        if (!q) return;
        let tableHtml = '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;margin:6px 0;">';
        for (let r = 0; r < tableRows; r++) {
            tableHtml += '<tr>';
            for (let c = 0; c < tableCols; c++) {
                tableHtml += `<td style="border:1px solid #e5e7eb;padding:6px;min-width:40px;">&nbsp;</td>`;
            }
            tableHtml += '</tr>';
        }
        tableHtml += '</table><p><br></p>';
        const range = q.getSelection(true);
        q.clipboard.dangerouslyPasteHTML(range.index, tableHtml);
        setTableDialogOpen(false);
    };

    return (
        <>
            <div className={`editor-toolbar flex items-center gap-0.5 flex-wrap ${className}`}>
                {/* Text Format */}
                <button type="button" onClick={() => formatAction('bold')} title="Bold"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
                    </svg>
                </button>
                <button type="button" onClick={() => formatAction('italic')} title="Italic"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
                    </svg>
                </button>
                <button type="button" onClick={() => formatAction('underline')} title="Underline"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/>
                    </svg>
                </button>
                <button type="button" onClick={() => formatAction('strike')} title="Strikethrough"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>
                    </svg>
                </button>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Alignment */}
                <button type="button" onClick={() => handleAlign('')} title="Align Left"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                </button>
                <button type="button" onClick={() => handleAlign('center')} title="Align Center"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/></svg>
                </button>
                <button type="button" onClick={() => handleAlign('right')} title="Align Right"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="7" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
                </button>
                <button type="button" onClick={() => handleAlign('justify')} title="Justify"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
                </button>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Lists */}
                <button type="button" onClick={() => handleList('ordered')} title="Numbered List"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
                        <path d="M4 6h1v4"/><path d="M4 10H6"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1.5"/>
                    </svg>
                </button>
                <button type="button" onClick={() => handleList('bullet')} title="Bullet List"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
                        <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>
                    </svg>
                </button>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Link & Image */}
                <button type="button" onClick={handleLink} title="Sisipkan Link"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                </button>
                <label title="Sisipkan Gambar"
                    className={`w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors cursor-pointer ${imageUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {imageUploading ? (
                        <span className="animate-spin text-xs">⟳</span>
                    ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                    )}
                    <input type="file" accept="image/*" className="hidden" disabled={imageUploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
                </label>

                <div className="flex-1" />

                {/* LaTeX */}
                <button type="button" onClick={handleInsertLatex} title="Sisipkan Rumus"
                    className="px-2 py-1 rounded-md bg-blue-50 text-blue-600 text-[10px] font-semibold hover:bg-blue-100 transition-colors flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                    </svg>
                    fx
                </button>

                {/* Table */}
                <button type="button" onClick={() => setTableDialogOpen(true)} title="Sisipkan Tabel"
                    className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-semibold hover:bg-emerald-100 transition-colors flex items-center gap-1 ml-0.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="3" y1="9" x2="21" y2="9"/>
                        <line x1="3" y1="15" x2="21" y2="15"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                        <line x1="15" y1="3" x2="15" y2="21"/>
                    </svg>
                    Tabel
                </button>
            </div>

            {/* Table Dialog */}
            {tableDialogOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className="bg-white rounded-lg shadow-2xl w-full max-w-xs mx-4 overflow-hidden border border-slate-100"
                    >
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                        <line x1="3" y1="9" x2="21" y2="9"/>
                                        <line x1="3" y1="15" x2="21" y2="15"/>
                                        <line x1="9" y1="3" x2="9" y2="21"/>
                                        <line x1="15" y1="3" x2="15" y2="21"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">Sisipkan Tabel</h3>
                                    <p className="text-[10px] text-slate-400">Tentukan ukuran tabel</p>
                                </div>
                            </div>
                            <button onClick={() => setTableDialogOpen(false)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-center">
                                <div className="grid gap-1"
                                    style={{ gridTemplateColumns: `repeat(${tableCols}, 24px)`, gridTemplateRows: `repeat(${tableRows}, 24px)` }}>
                                    {Array.from({ length: tableRows * tableCols }).map((_, i) => (
                                        <div key={i} className="bg-slate-100 rounded border border-slate-200" />
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Baris</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setTableRows(Math.max(1, tableRows - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">−</button>
                                    <span className="flex-1 text-center font-bold text-slate-700">{tableRows}</span>
                                    <button onClick={() => setTableRows(Math.min(10, tableRows + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">+</button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Kolom</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setTableCols(Math.max(1, tableCols - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">−</button>
                                    <span className="flex-1 text-center font-bold text-slate-700">{tableCols}</span>
                                    <button onClick={() => setTableCols(Math.min(10, tableCols + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">+</button>
                                </div>
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                            <button onClick={() => setTableDialogOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">Batal</button>
                            <button onClick={insertTable} className="px-5 py-2 text-sm font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20">Sisipkan</button>
                        </div>
                    </motion.div>
                </div>
            )}
        </>
    );
});

SharedToolbar.displayName = 'SharedToolbar';

// ─── OptionToolbar ────────────────────────────────────────────────────────────
/**
 * OptionToolbar — Simplified insert toolbar for answer options.
 * Only has insert buttons: image, equation, table.
 * No text formatting controls (bold, italic, etc.).
 */
interface OptionToolbarProps {
    className?: string;
}

export const OptionToolbar = React.memo(({ className = '' }: OptionToolbarProps) => {
    const ctx = useRichInputToolbar();
    const activeQuill = ctx?.activeQuill;

    // Image upload state
    const [imageUploading, setImageUploading] = useState(false);

    // LaTeX dialog state
    const [latexDialogOpen, setLatexDialogOpen] = useState(false);
    const [latexInput, setLatexInput] = useState('');

    // Table dialog state
    const [tableDialogOpen, setTableDialogOpen] = useState(false);
    const [tableRows, setTableRows] = useState(2);
    const [tableCols, setTableCols] = useState(2);

    const handleImageFile = async (file: File) => {
        const q = activeQuill?.current;
        if (!q) return;
        setImageUploading(true);
        try {
            const res = await uploadToHosting(file, 'questions');
            const url = res.success ? res.url : '';
            if (url) {
                const range = q.getSelection(true);
                const imgHtml = `<img src="${url}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:4px 0;" />`;
                q.clipboard.dangerouslyPasteHTML(range.index, imgHtml);
            }
        } catch (err) {
            console.error('Image upload failed:', err);
        } finally {
            setImageUploading(false);
        }
    };

    const handleInsertLatexFromDialog = () => {
        const q = activeQuill?.current;
        if (!q || !latexInput.trim()) return;
        const range = q.getSelection(true);
        q.insertText(range.index, `$${latexInput.trim()}$`);
        setLatexInput('');
        setLatexDialogOpen(false);
    };

    const insertTable = () => {
        const q = activeQuill?.current;
        if (!q) return;
        let tableHtml = '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;margin:6px 0;">';
        for (let r = 0; r < tableRows; r++) {
            tableHtml += '<tr>';
            for (let c = 0; c < tableCols; c++) {
                tableHtml += `<td style="border:1px solid #e5e7eb;padding:6px;min-width:40px;">&nbsp;</td>`;
            }
            tableHtml += '</tr>';
        }
        tableHtml += '</table><p><br></p>';
        const range = q.getSelection(true);
        q.clipboard.dangerouslyPasteHTML(range.index, tableHtml);
        setTableDialogOpen(false);
    };

    return (
        <>
            <div className={`flex items-center gap-2 flex-wrap ${className}`}>
                {/* Image */}
                <label title="Sisipkan Gambar"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition-colors cursor-pointer ${imageUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {imageUploading ? (
                        <span className="animate-spin text-sm">⟳</span>
                    ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                    )}
                    Gambar
                    <input type="file" accept="image/*" className="hidden" disabled={imageUploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
                </label>

                {/* Equation */}
                <button type="button"
                    onClick={() => setLatexDialogOpen(true)}
                    title="Sisipkan Rumus"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-semibold hover:bg-amber-100 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                    </svg>
                    Equation
                </button>

                {/* Table */}
                <button type="button"
                    onClick={() => setTableDialogOpen(true)}
                    title="Sisipkan Tabel"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-xs font-semibold hover:bg-emerald-100 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="3" y1="9" x2="21" y2="9"/>
                        <line x1="3" y1="15" x2="21" y2="15"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                        <line x1="15" y1="3" x2="15" y2="21"/>
                    </svg>
                    Tabel
                </button>
            </div>

            {/* Equation Dialog */}
            {latexDialogOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className="bg-white rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-slate-100"
                    >
                        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5">
                                        <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">Sisipkan Persamaan</h3>
                                    <p className="text-[10px] text-amber-600">Gunakan LaTeX (tanpa $)</p>
                                </div>
                            </div>
                            <button onClick={() => { setLatexDialogOpen(false); setLatexInput(''); }} className="p-1.5 hover:bg-amber-100 rounded-lg transition-colors">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <textarea
                                value={latexInput}
                                onChange={(e) => setLatexInput(e.target.value)}
                                placeholder="Contoh: \frac{a}{b} atau x^2 + y^2 = r^2"
                                rows={4}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none font-mono placeholder:font-sans placeholder:text-slate-300"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        handleInsertLatexFromDialog();
                                    }
                                }}
                                autoFocus
                            />
                            <div className="text-xs text-slate-400 space-y-1">
                                <p className="font-semibold">Tips penulisan:</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px]">
                                    <code>{"\\frac{a}{b}"}</code><span className="text-slate-500">pecahan</span>
                                    <code>x^2</code><span className="text-slate-500">pangkat</span>
                                    <code>{"\\sqrt{x}"}</code><span className="text-slate-500">akar</span>
                                    <code>{"\\sum"}</code><span className="text-slate-500">sigma</span>
                                    <code>{"\\int"}</code><span className="text-slate-500">integral</span>
                                    <code>{"\\alpha, \\beta"}</code><span className="text-slate-500">huruf Yunani</span>
                                </div>
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                            <button onClick={() => { setLatexDialogOpen(false); setLatexInput(''); }}
                                className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
                                Batal
                            </button>
                            <button onClick={handleInsertLatexFromDialog}
                                className="px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/20">
                                Sisipkan
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Table Dialog */}
            {tableDialogOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className="bg-white rounded-lg shadow-2xl w-full max-w-xs mx-4 overflow-hidden border border-slate-100"
                    >
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                        <line x1="3" y1="9" x2="21" y2="9"/>
                                        <line x1="3" y1="15" x2="21" y2="15"/>
                                        <line x1="9" y1="3" x2="9" y2="21"/>
                                        <line x1="15" y1="3" x2="15" y2="21"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">Sisipkan Tabel</h3>
                                    <p className="text-[10px] text-slate-400">Tentukan ukuran tabel</p>
                                </div>
                            </div>
                            <button onClick={() => setTableDialogOpen(false)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-center">
                                <div className="grid gap-1"
                                    style={{ gridTemplateColumns: `repeat(${tableCols}, 24px)`, gridTemplateRows: `repeat(${tableRows}, 24px)` }}>
                                    {Array.from({ length: tableRows * tableCols }).map((_, i) => (
                                        <div key={i} className="bg-slate-100 rounded border border-slate-200" />
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Baris</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setTableRows(Math.max(1, tableRows - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">−</button>
                                    <span className="flex-1 text-center font-bold text-slate-700">{tableRows}</span>
                                    <button onClick={() => setTableRows(Math.min(10, tableRows + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">+</button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Kolom</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setTableCols(Math.max(1, tableCols - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">−</button>
                                    <span className="flex-1 text-center font-bold text-slate-700">{tableCols}</span>
                                    <button onClick={() => setTableCols(Math.min(10, tableCols + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors font-bold">+</button>
                                </div>
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                            <button onClick={() => setTableDialogOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">Batal</button>
                            <button onClick={insertTable} className="px-5 py-2 text-sm font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20">Sisipkan</button>
                        </div>
                    </motion.div>
                </div>
            )}
        </>
    );
});

OptionToolbar.displayName = 'OptionToolbar';
