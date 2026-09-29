"use client";
import {
createDimension,
createDimensionInterpretation,
deleteDimension,
deleteDimensionInterpretation,
DimensionInterpretationItem,
DimensionItem,
getDimensionInterpretationsByBank,
getDimensionsByBank,
updateDimension,
updateDimensionInterpretation,
} from '@/lib/api/questions';
import { BarChart2,Edit3,Plus,Settings2,Trash2,X } from 'lucide-react';
import { useCallback,useEffect,useState } from 'react';

interface DimensionManagerProps {
    bankId: string;
}

export default function DimensionManager({ bankId }: DimensionManagerProps) {
    const [dimensions, setDimensions] = useState<DimensionItem[]>([]);
    const [interpretations, setInterpretations] = useState<DimensionInterpretationItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Interpretations Editor
    const [isInterpEditorOpen, setIsInterpEditorOpen] = useState(false);
    const [interpDimensionId, setInterpDimensionId] = useState<string | null>(null);
    const [editingInterpId, setEditingInterpId] = useState<string | null>(null);
    const [iMin, setIMin] = useState('');
    const [iMax, setIMax] = useState('');
    const [iTitle, setITitle] = useState('');
    const [iDesc, setIDesc] = useState('');

    const loadData = useCallback(async () => {
        const [dimData, interpData] = await Promise.all([
            getDimensionsByBank(bankId),
            getDimensionInterpretationsByBank(bankId)
        ]);
        setDimensions(dimData || []);
        setInterpretations(interpData || []);
        setIsLoading(false);
    }, [bankId]);

    useEffect(() => {
        let active = true;

        void Promise.all([
            getDimensionsByBank(bankId),
            getDimensionInterpretationsByBank(bankId),
        ]).then(([dimData, interpData]) => {
            if (!active) return;
            setDimensions(dimData || []);
            setInterpretations(interpData || []);
            setIsLoading(false);
        });

        return () => {
            active = false;
        };
    }, [bankId]);

    const handleOpenEditor = (d: DimensionItem | null = null) => {
        if (d) {
            setEditingId(d.id);
            setName(d.name || '');
            setDescription(d.description || '');
        } else {
            setEditingId(null);
            setName('');
            setDescription('');
        }
        setIsEditorOpen(true);
    };

    const handleSave = async () => {
        if (!name.trim()) return alert("Nama dimensi tidak boleh kosong");
        setIsSubmitting(true);
        if (editingId) {
            await updateDimension(editingId, name, description);
        } else {
            await createDimension(bankId, name, description);
        }
        setIsSubmitting(false);
        setIsEditorOpen(false);
        void loadData();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Yakin ingin menghapus dimensi ini? Soal yang terhubung akan kehilangan dimensi ini.')) return;
        await deleteDimension(id);
        void loadData();
    };

    // --- Interpretations ---

    const handleOpenInterpEditor = (dimId: string, i: DimensionInterpretationItem | null = null) => {
        setInterpDimensionId(dimId);
        if (i) {
            setEditingInterpId(i.id);
            setIMin(i.min_score.toString());
            setIMax(i.max_score.toString());
            setITitle(i.title || '');
            setIDesc(i.interpretation || '');
        } else {
            setEditingInterpId(null);
            setIMin('');
            setIMax('');
            setITitle('');
            setIDesc('');
        }
        setIsInterpEditorOpen(true);
    };

    const handleSaveInterp = async () => {
        if (!interpDimensionId) return;
        if (!iMin || !iMax || !iTitle.trim() || !iDesc.trim()) return alert("Semua kolom harus diisi");
        setIsSubmitting(true);
        if (editingInterpId) {
            await updateDimensionInterpretation(editingInterpId, Number(iMin), Number(iMax), iTitle, iDesc);
        } else {
            await createDimensionInterpretation(interpDimensionId, Number(iMin), Number(iMax), iTitle, iDesc);
        }
        setIsSubmitting(false);
        setIsInterpEditorOpen(false);
        void loadData();
    };

    const handleDeleteInterp = async (id: string) => {
        if (!confirm('Hapus interpretasi ini?')) return;
        await deleteDimensionInterpretation(id);
        void loadData();
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400">Memuat dimensi...</div>;
    }

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800">Manajemen Kepribadian</h2>
                    <p className="text-sm text-slate-500">Buat dimensi pengukuran dan atur rentang interpretasi kesimpulannya.</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                        onClick={() => handleOpenEditor()}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm shadow-indigo-200 transition-colors"
                    >
                        <Plus size={16} /> Tambah Dimensi
                    </button>
                </div>
            </div>

            {/* ── List ── */}
            {dimensions.length === 0 ? (
                <div className="text-center p-12 bg-white rounded-xl border border-slate-200 border-dashed">
                    <p className="text-slate-400">Belum ada dimensi di bank soal ini.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5">
                    {dimensions.map(d => {
                        const dimsInterps = interpretations.filter(i => i.dimension_id === d.id);
                        return (
                            <div key={d.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                                {/* Dimension Header */}
                                <div className="p-5 flex flex-col md:flex-row gap-4 justify-between bg-slate-50/50">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                                                <BarChart2 size={16} />
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-800">{d.name}</h3>
                                        </div>
                                        {d.description && (
                                            <p className="text-sm text-slate-500 mt-2 ml-10">
                                                {d.description}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-start gap-2 shrink-0">
                                        <button onClick={() => handleOpenEditor(d)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200">
                                            <Edit3 size={14} /> Edit Dimensi
                                        </button>
                                        <button onClick={() => handleDelete(d.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100">
                                            <Trash2 size={14} /> Hapus
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Interpretations Section */}
                                <div className="p-5 border-t border-slate-100">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                            <Settings2 size={14} className="text-indigo-500" /> Rentang Interpretasi
                                        </h4>
                                        <button 
                                            onClick={() => handleOpenInterpEditor(d.id)}
                                            className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition-colors"
                                        >
                                            + Tambah Rentang
                                        </button>
                                    </div>

                                    {dimsInterps.length === 0 ? (
                                        <div className="p-4 rounded-lg border border-dashed border-slate-200 text-center">
                                            <p className="text-xs text-slate-400">Belum ada interpretasi normatif untuk dimensi ini. Laporan siswa akan menggunakan narasi standar.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {dimsInterps.map((interp) => (
                                                <div key={interp.id} className="relative p-4 rounded-lg border border-slate-100 bg-slate-50 hover:border-indigo-200 transition-colors group">
                                                    <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => handleOpenInterpEditor(d.id, interp)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-md shadow-sm border border-transparent hover:border-slate-200 transition-all">
                                                            <Edit3 size={12} />
                                                        </button>
                                                        <button onClick={() => handleDeleteInterp(interp.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-md shadow-sm border border-transparent hover:border-slate-200 transition-all">
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                    <div className="inline-block px-2 py-0.5 rounded text-[10px] font-black tracking-widest text-indigo-600 bg-indigo-100 border border-indigo-200 mb-2">
                                                        SKOR: {interp.min_score} - {interp.max_score}
                                                    </div>
                                                    <h5 className="font-bold text-slate-800 text-sm mb-1">{interp.title}</h5>
                                                    <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{interp.interpretation}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Dimension Editor Modal ── */}
            {isEditorOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-lg">
                                {editingId ? 'Edit Dimensi' : 'Tambah Dimensi Baru'}
                            </h3>
                            <button onClick={() => setIsEditorOpen(false)} className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nama Dimensi</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Misal: Integritas, Kepemimpinan..."
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Deskripsi Singkat</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="Jelaskan karakteristik dimensi ini..."
                                    rows={4}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                            <button onClick={() => setIsEditorOpen(false)} className="px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                                Batal
                            </button>
                            <button onClick={handleSave} disabled={isSubmitting} className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50">
                                {isSubmitting ? 'Menyimpan...' : 'Simpan Dimensi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Interpretation Editor Modal ── */}
            {isInterpEditorOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                            <h3 className="font-bold text-slate-800 text-lg">
                                {editingInterpId ? 'Edit Interpretasi' : 'Tambah Interpretasi'}
                            </h3>
                            <button onClick={() => setIsInterpEditorOpen(false)} className="p-2 hover:bg-indigo-100 rounded-lg text-slate-400 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Skor Minimum</label>
                                    <input
                                        type="number"
                                        value={iMin}
                                        onChange={e => setIMin(e.target.value)}
                                        placeholder="0"
                                        className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Skor Maksimum</label>
                                    <input
                                        type="number"
                                        value={iMax}
                                        onChange={e => setIMax(e.target.value)}
                                        placeholder="20"
                                        className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Judul Karakter</label>
                                <input
                                    type="text"
                                    value={iTitle}
                                    onChange={e => setITitle(e.target.value)}
                                    placeholder="Contoh: Sangat Disiplin, Kurang Peduli, dsb."
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Paragraf Analisis / Saran</label>
                                <textarea
                                    value={iDesc}
                                    onChange={e => setIDesc(e.target.value)}
                                    placeholder="Tuliskan analisis psikologis mendetail yang akan dibaca siswa jika mereka mendapatkan skor di rentang ini..."
                                    rows={5}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none leading-relaxed"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                            <button onClick={() => setIsInterpEditorOpen(false)} className="px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                                Batal
                            </button>
                            <button onClick={handleSaveInterp} disabled={isSubmitting} className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                {isSubmitting ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
