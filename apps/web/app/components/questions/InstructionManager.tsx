"use client";
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { TipTapEditor } from '@/app/components/questions/TipTapEditor';
import {
BankTextItem,
createInstruction,
deleteInstruction,
getInstructionsByBank,
importInstructionsFromXlsAction,
ImportRow,
updateInstruction,
} from '@/lib/api/questions';
import { parseDocxToStimuliOrInstructions } from '@/lib/doc-parser';
import { uploadToHosting } from '@/lib/uploader';
import { AlertCircle,Check,Download,Edit3,Plus,Trash2,Upload,X } from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';

interface InstructionManagerProps {
    bankId: string;
}

export default function InstructionManager({ bankId }: InstructionManagerProps) {
    const [instructions, setInstructions] = useState<BankTextItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Import modal state
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [importSuccessCount, setImportSuccessCount] = useState(0);
    const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadInstructions = useCallback(async () => {
        const data = await getInstructionsByBank(bankId);
        setInstructions(data || []);
        setIsLoading(false);
    }, [bankId]);

    useEffect(() => {
        let active = true;

        void getInstructionsByBank(bankId).then(data => {
            if (!active) return;
            setInstructions(data || []);
            setIsLoading(false);
        });

        return () => {
            active = false;
        };
    }, [bankId]);

    const downloadTemplateDocx = async () => {
        window.open('/template_soal_pengetahuan.docx?v=20261001', '_blank');
    };

    // ── Parse File and Show Preview ────────────────────────────────
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        setImportErrors([]);
        setImportSuccessCount(0);
        setPreviewRows([]);

        try {
            const parsed = await parseDocxToStimuliOrInstructions(file, 'instruction');
            const rows = parsed.map(item => ({
                Judul: item.title,
                Konten: item.content.replace(/<[^>]*>/g, '').trim(),
                Konten_HTML: item.content
            }));

            if (rows.length === 0) {
                setImportErrors(['File kosong atau tidak memiliki data petunjuk yang valid.']);
            } else {
                setPreviewRows(rows);
            }
        } catch (err: unknown) {
            setImportErrors(['Gagal membaca file: ' + (err instanceof Error ? err.message : 'Kesalahan tidak diketahui')]);
        } finally {
            setIsImporting(false);
        }
    };

    // ── Execute Import ─────────────────────────────────────────────
    const executeImport = async () => {
        setIsImporting(true);
        setImportErrors([]);
        try {
            const result = await importInstructionsFromXlsAction(bankId, previewRows);
            if (result.success) {
                setImportSuccessCount(result.imported);
                setPreviewRows([]);
                void loadInstructions();
            } else {
                setImportErrors(result.errors);
            }
        } catch (err: unknown) {
            setImportErrors(['Gagal import: ' + (err instanceof Error ? err.message : 'Kesalahan tidak diketahui')]);
        } finally {
            setIsImporting(false);
        }
    };

    const handleOpenImport = () => {
        setIsImportOpen(true);
        setImportErrors([]);
        setImportSuccessCount(0);
        setPreviewRows([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleOpenEditor = (s: BankTextItem | null = null) => {
        if (s) {
            setEditingId(s.id);
            setTitle(s.title || '');
            setContent(s.content || '');
        } else {
            setEditingId(null);
            setTitle('');
            setContent('');
        }
        setIsEditorOpen(true);
    };

    const handleSave = async () => {
        if (!content.trim()) return alert("Konten petunjuk tidak boleh kosong");
        setIsSubmitting(true);
        if (editingId) {
            await updateInstruction(editingId, title, content);
        } else {
            await createInstruction(bankId, title, content);
        }
        setIsSubmitting(false);
        setIsEditorOpen(false);
        void loadInstructions();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Yakin ingin menghapus petunjuk ini? Soal yang terhubung akan kehilangan petunjuk ini.')) return;
        await deleteInstruction(id);
        void loadInstructions();
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400">Memuat petunjuk...</div>;
    }

    return (
        <div className="space-y-4">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-4">
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800">Daftar Petunjuk</h2>
                    <p className="text-sm text-slate-500">Buat teks petunjuk soal yang bisa dihubungkan ke banyak soal sekaligus (Misal: Petunjuk Pilihan Ganda Kompleks).</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                        onClick={handleOpenImport}
                        className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 flex items-center gap-2"
                    >
                        <Upload size={15} /> Import Word
                    </button>
                    <button
                        onClick={() => handleOpenEditor()}
                        className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 flex items-center gap-2"
                    >
                        <Plus size={16} /> Buat Petunjuk
                    </button>
                </div>
            </div>

            {/* ── List ── */}
            {instructions.length === 0 ? (
                <div className="text-center p-12 bg-white rounded-lg border border-slate-200 border-dashed">
                    <p className="text-slate-400">Belum ada petunjuk di bank soal ini.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {instructions.map(s => (
                        <div key={s.id} className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex gap-4">
                            <div className="flex-1 min-w-0">
                                {s.title && <h3 className="text-md font-bold text-slate-800 mb-2">{s.title}</h3>}
                                <div className="text-sm text-slate-600 line-clamp-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <LatexRenderer text={s.content} />
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                                <button onClick={() => handleOpenEditor(s)} className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg">
                                    <Edit3 size={16} />
                                </button>
                                <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Editor Modal ── */}
            {isEditorOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 text-lg">
                                {editingId ? 'Edit Petunjuk' : 'Buat Petunjuk Baru'}
                            </h3>
                            <button onClick={() => setIsEditorOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Judul (Opsional)</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder="Contoh: Petunjuk Isian Singkat"
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Konten Petunjuk</label>
                                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                    <TipTapEditor
                                        content={content}
                                        onChange={setContent}
                                        placeholder="Ketik teks petunjuk soal di sini..."
                                        minHeight="200px"
                                        onImageUpload={async (file: File) => {
                                            const result = await uploadToHosting(file, 'questions');
                                            if (!result.success || !result.url) {
                                                throw new Error(result.error || 'Gagal mengunggah gambar petunjuk.');
                                            }
                                            return result.url;
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
                            <button
                                onClick={() => setIsEditorOpen(false)}
                                className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Menyimpan...' : <><Check size={16} /> Simpan Petunjuk</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Import Modal ── */}
            {isImportOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 text-lg">Import Petunjuk dari Word</h3>
                            <button onClick={() => setIsImportOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            {/* Info */}
                            {previewRows.length === 0 && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700 space-y-1">
                                    <p className="font-semibold">Format kolom / tabel yang didukung:</p>
                                    <p><strong>Judul</strong> — nama petunjuk (opsional)</p>
                                    <p><strong>Konten / Konten_HTML</strong> — teks petunjuk (wajib, mendukung rich text/equation/tabel di Word)</p>
                                    <div className="pt-3">
                                        <button
                                            onClick={downloadTemplateDocx}
                                            className="text-[11px] font-semibold bg-blue-100 hover:bg-blue-200 text-blue-800 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                                        >
                                            <Download size={12} /> Template Word (DOCX)
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* File picker */}
                            {previewRows.length === 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Pilih file Word (.docx)</label>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".docx"
                                        onChange={handleFileChange}
                                        className="hidden"
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isImporting}
                                        className="w-full border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        <Upload className="mx-auto mb-2 text-slate-400" size={28} />
                                        <p className="text-sm font-medium text-slate-600">
                                            {isImporting ? 'Memproses file...' : 'Klik untuk pilih file .docx'}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-1">Maks 10MB</p>
                                    </button>
                                </div>
                            )}

                            {/* Preview Area */}
                            {previewRows.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-slate-700">Pratinjau Data ({previewRows.length} item)</h4>
                                        <button
                                            onClick={() => setPreviewRows([])}
                                            className="text-xs text-red-500 hover:underline font-medium"
                                        >
                                            Pilih File Lain
                                        </button>
                                    </div>
                                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto bg-slate-50">
                                        <table className="min-w-full divide-y divide-slate-200 text-xs">
                                            <thead className="bg-slate-100 sticky top-0">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-semibold text-slate-600 w-1/3">Judul</th>
                                                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Konten</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200 bg-white">
                                                {previewRows.map((row, idx) => (
                                                    <tr key={idx}>
                                                        <td className="px-3 py-2 font-medium text-slate-800 break-all align-top">{row.Judul || '-'}</td>
                                                        <td className="px-3 py-2 text-slate-600 align-top">
                                                            <div className="line-clamp-2 break-all text-[11px]"><LatexRenderer text={row.Konten_HTML || row.Konten || ""} /></div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <button
                                        onClick={executeImport}
                                        disabled={isImporting}
                                        className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-primary/20"
                                    >
                                        {isImporting ? 'Mengimport...' : <><Check size={16} /> Konfirmasi & Import Sekarang</>}
                                    </button>
                                </div>
                            )}

                            {/* Success */}
                            {importSuccessCount > 0 && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700 flex items-start gap-2">
                                    <Check className="mt-0.5 shrink-0" size={16} />
                                    <span><strong>{importSuccessCount}</strong> petunjuk berhasil di-import!</span>
                                </div>
                            )}

                            {/* Errors */}
                            {importErrors.length > 0 && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-2">
                                    <AlertCircle className="mt-0.5 shrink-0" size={16} />
                                    <div>
                                        <p className="font-semibold mb-1">Gagal import:</p>
                                        <ul className="list-disc list-inside space-y-0.5">
                                            {importErrors.map((err, i) => <li key={i}>{err}</li>)}
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end bg-slate-50 rounded-b-lg">
                            <button onClick={() => setIsImportOpen(false)} className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">
                                Tutup
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
