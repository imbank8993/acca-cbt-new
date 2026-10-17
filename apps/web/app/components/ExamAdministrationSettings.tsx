'use client';

import { useEffect, useState } from 'react';
import { getSettings, updateSetting, type ExamAdministrationSettings as Settings } from '@/lib/api/settings';
import { Save, Settings2 } from 'lucide-react';

export default function ExamAdministrationSettings() {
    const [form, setForm] = useState<Settings>({ committee_chair_name: '', committee_chair_nip: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    useEffect(() => {
        let active = true;
        void getSettings({ refresh: true }).then(result => {
            if (!active) return;
            if (!result.success) { setError(result.error); return; }
            const value = result.settings.find(row => row.key === 'exam_administration')?.value as Partial<Settings> | undefined;
            setForm({ committee_chair_name: value?.committee_chair_name || '', committee_chair_nip: value?.committee_chair_nip || '' });
        }).catch(() => { if (active) setError('Pengaturan belum dapat dimuat. Silakan muat ulang halaman.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true); setError(''); setNotice('');
        try {
            const result = await updateSetting('exam_administration', {
                committee_chair_name: form.committee_chair_name.trim(),
                committee_chair_nip: form.committee_chair_nip.trim(),
            });
            if (!result.success) setError(result.error);
            else setNotice('Ketua Panitia berhasil disimpan. Digunakan saat dokumen berikutnya ditandatangani.');
        } catch { setError('Pengaturan belum berhasil disimpan. Coba kembali.'); }
        finally { setSaving(false); }
    };

    return <div className="mx-auto max-w-3xl space-y-5 pb-24">
        <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Settings2 size={22} /> Pengaturan Administrasi Ujian</h1>
            <p className="mt-2 text-sm text-slate-500">Penandatangan berita acara dan daftar hadir ASAS, ASAT, dan Asesmen Madrasah.</p>
        </div>
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div>
                <h2 className="font-semibold text-slate-900">Mengetahui, Ketua Panitia</h2>
                <p className="mt-1 text-sm text-slate-500">Pengawas mengikuti penugasan ruang dan sesi. Proktor otomatis berasal dari pengguna yang membuat folder ujian.</p>
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
            <fieldset disabled={loading || saving} className="space-y-4 disabled:opacity-60">
                <div>
                    <label htmlFor="committee-chair-name" className="mb-1.5 block text-sm font-medium text-slate-700">Nama lengkap Ketua Panitia <span aria-hidden="true">*</span></label>
                    <input id="committee-chair-name" required maxLength={200} value={form.committee_chair_name}
                        onChange={e => setForm(previous => ({ ...previous, committee_chair_name: e.target.value }))}
                        placeholder="Nama lengkap beserta gelar" className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                </div>
                <div>
                    <label htmlFor="committee-chair-nip" className="mb-1.5 block text-sm font-medium text-slate-700">NIP Ketua Panitia (opsional)</label>
                    <input id="committee-chair-nip" maxLength={100} value={form.committee_chair_nip}
                        onChange={e => setForm(previous => ({ ...previous, committee_chair_nip: e.target.value }))}
                        placeholder="NIP, jika ada" className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                </div>
                <p className="text-xs leading-relaxed text-slate-500">Perubahan berlaku saat dokumen disimpan dan ditandatangani kembali. Dokumen yang sudah ditandatangani tetap menyimpan nama Ketua Panitia saat pengesahan.</p>
                <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    <Save size={16} /> {loading ? 'Memuat pengaturan...' : saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </button>
            </fieldset>
        </form>
    </div>;
}
