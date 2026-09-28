"use client";
import {
createKisiKisi,
deleteKisiKisi,
getKisiKisiByBank,
KisiKisiItem,
updateKisiKisi,
} from '@/lib/api/questions';
import { Check,Edit3,Plus,Search,Trash2,X } from 'lucide-react';
import { useCallback,useEffect,useState } from 'react';

interface KisiKisiTabProps {
    bankId: string;
}

export default function KisiKisiTab({ bankId }: KisiKisiTabProps) {
    const [kisiKisi, setKisiKisi] = useState<KisiKisiItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Form states
    const [nomorKd, setNomorKd] = useState('');
    const [kdCp, setKdCp] = useState('');
    const [materi, setMateri] = useState('');
    const [indikatorSoal, setIndikatorSoal] = useState('');
    const [levelKognitif, setLevelKognitif] = useState('L1');

    const loadKisiKisi = useCallback(async () => {
        const data = await getKisiKisiByBank(bankId);
        setKisiKisi(data || []);
        setIsLoading(false);
    }, [bankId]);

    useEffect(() => {
        let active = true;

        void getKisiKisiByBank(bankId).then(data => {
            if (!active) return;
            setKisiKisi(data || []);
            setIsLoading(false);
        });

        return () => {
            active = false;
        };
    }, [bankId]);

    const handleOpenEditor = (k: KisiKisiItem | null = null) => {
        if (k) {
            setEditingId(k.id);
            setNomorKd(k.nomor_kd || '');
            setKdCp(k.kd_cp || '');
            setMateri(k.materi || '');
            setIndikatorSoal(k.indikator_soal || '');
            setLevelKognitif(k.level_kognitif || 'L1');
        } else {
            setEditingId(null);
            setNomorKd('');
            setKdCp('');
            setMateri('');
            setIndikatorSoal('');
            setLevelKognitif('L1');
        }
        setIsEditorOpen(true);
    };

    const handleSave = async () => {
        if (!nomorKd.trim()) return alert("Nomor KD wajib diisi");
        
        setIsSubmitting(true);
        const data = {
            nomor_kd: nomorKd,
            kd_cp: kdCp,
            materi: materi,
            indikator_soal: indikatorSoal,
            level_kognitif: levelKognitif
        };

        if (editingId) {
            const result = await updateKisiKisi(editingId, data);
            if (!result.success) { alert('Gagal menyimpan: ' + result.error); setIsSubmitting(false); return; }
        } else {
            const result = await createKisiKisi(bankId, data);
            if (!result.success) { alert('Gagal menyimpan: ' + result.error); setIsSubmitting(false); return; }
        }
        setIsSubmitting(false);
        setIsEditorOpen(false);
        void loadKisiKisi();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Yakin ingin menghapus kisi-kisi ini? Soal yang merujuk pada kisi-kisi ini akan kehilangan relasinya.')) return;
        await deleteKisiKisi(id);
        void loadKisiKisi();
    };

    const filteredData = kisiKisi.filter(k => 
        (k.nomor_kd || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (k.materi || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (k.indikator_soal || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400">Memuat kisi-kisi...</div>;
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800">Kisi-kisi Soal</h2>
                    <p className="text-sm text-slate-500">Buat rancangan pemetaan soal berdasarkan Kompetensi Dasar / Capaian Pembelajaran.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                            type="text" 
                            placeholder="Cari KD / Materi..." 
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500 w-full sm:w-64"
                        />
                    </div>
                    <button
                        onClick={() => handleOpenEditor()}
                        className="px-4 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-600 flex items-center gap-2"
                    >
                        <Plus size={16} /> Tambah Kisi-kisi
                    </button>
                </div>
            </div>

            {/* Table */}
            {kisiKisi.length === 0 ? (
                <div className="text-center p-12 bg-white rounded-lg border border-slate-200 border-dashed">
                    <p className="text-slate-400">Belum ada kisi-kisi di bank soal ini.</p>
                </div>
            ) : (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold text-slate-700 w-24">No. KD/CP</th>
                                <th className="px-4 py-3 text-left font-semibold text-slate-700">KD / CP</th>
                                <th className="px-4 py-3 text-left font-semibold text-slate-700">Materi</th>
                                <th className="px-4 py-3 text-left font-semibold text-slate-700">Indikator Soal</th>
                                <th className="px-4 py-3 text-center font-semibold text-slate-700 w-28">Level Kognitif</th>
                                <th className="px-4 py-3 text-right font-semibold text-slate-700 w-24">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                            {filteredData.map(k => (
                                <tr key={k.id} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-3 font-semibold text-slate-800 align-top">{k.nomor_kd}</td>
                                    <td className="px-4 py-3 text-slate-600 align-top">{k.kd_cp || '-'}</td>
                                    <td className="px-4 py-3 text-slate-600 align-top">{k.materi || '-'}</td>
                                    <td className="px-4 py-3 text-slate-600 align-top">{k.indikator_soal || '-'}</td>
                                    <td className="px-4 py-3 text-center align-top">
                                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                            k.level_kognitif === 'L1' ? 'bg-green-100 text-green-700' :
                                            k.level_kognitif === 'L2' ? 'bg-blue-100 text-blue-700' :
                                            k.level_kognitif === 'L3' ? 'bg-purple-100 text-purple-700' :
                                            'bg-slate-100 text-slate-700'
                                        }`}>
                                            {k.level_kognitif || '-'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 align-top text-right">
                                        <div className="flex justify-end gap-1">
                                            <button onClick={() => handleOpenEditor(k)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded" title="Edit">
                                                <Edit3 size={15} />
                                            </button>
                                            <button onClick={() => handleDelete(k.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="Hapus">
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredData.length === 0 && kisiKisi.length > 0 && (
                        <div className="p-8 text-center text-slate-500">Tidak ada kisi-kisi yang cocok dengan pencarian.</div>
                    )}
                </div>
            )}

            {/* Editor Modal */}
            {isEditorOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 text-lg">
                                {editingId ? 'Edit Kisi-kisi' : 'Tambah Kisi-kisi Baru'}
                            </h3>
                            <button onClick={() => setIsEditorOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Nomor KD / CP <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={nomorKd}
                                        onChange={e => setNomorKd(e.target.value)}
                                        placeholder="Contoh: 3.1"
                                        className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Level Kognitif</label>
                                    <select
                                        value={levelKognitif}
                                        onChange={e => setLevelKognitif(e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                                    >
                                        <option value="L1">L1 (Pengetahuan/Pemahaman)</option>
                                        <option value="L2">L2 (Aplikasi)</option>
                                        <option value="L3">L3 (Penalaran/HOTS)</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">KD / CP (Deskripsi)</label>
                                <textarea
                                    value={kdCp}
                                    onChange={e => setKdCp(e.target.value)}
                                    placeholder="Contoh: Menjelaskan konsep aljabar..."
                                    rows={2}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Materi Pokok</label>
                                <input
                                    type="text"
                                    value={materi}
                                    onChange={e => setMateri(e.target.value)}
                                    placeholder="Contoh: Aljabar Linear"
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Indikator Soal</label>
                                <textarea
                                    value={indikatorSoal}
                                    onChange={e => setIndikatorSoal(e.target.value)}
                                    placeholder="Contoh: Disajikan sebuah grafik, siswa dapat menghitung nilai x..."
                                    rows={3}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
                            <button onClick={() => setIsEditorOpen(false)} className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">Batal</button>
                            <button
                                onClick={handleSave}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 text-sm font-semibold bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Menyimpan...' : <><Check size={16} /> Simpan Kisi-kisi</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
