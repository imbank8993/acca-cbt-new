"use client";

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Database, Download, UploadCloud, AlertTriangle, CheckCircle2, XCircle, Loader2, ShieldAlert } from 'lucide-react';

export default function BackupRestorePage() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleExport = async () => {
    try {
      setIsExporting(true);

      // Sesi ada di cookie httpOnly `cbt_session`. Permintaan same-origin
      // mengirimnya otomatis, jadi tidak ada lagi token yang perlu dirakit
      // sendiri di sini — dan tidak ada token yang bisa terbaca JavaScript.
      const response = await fetch('/api/backup/export', { method: 'GET' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal membuat cadangan');
      }

      // Handle file download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Get filename from header if possible
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'backup.cbtbak';
      if (contentDisposition && contentDisposition.includes('filename="')) {
        filename = contentDisposition.split('filename="')[1].split('"')[0];
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Terjadi kesalahan saat memproses backup.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.cbtbak') && !file.name.endsWith('.zip')) {
      setImportStatus('error');
      setErrorMessage('Format file tidak valid. Harap gunakan file berekstensi .zip atau .cbtbak');
      return;
    }

    // Confirmation dialog
    if (!confirm('PERINGATAN KRITIKAL!\n\nMemulihkan data akan MENGHAPUS BERSIH seluruh data sekolah Anda saat ini (Kelas, Soal, Ujian, Nilai) dan menggantinya dengan data dari file backup.\n\nApakah Anda yakin ingin melanjutkan?')) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setIsImporting(true);
      setImportStatus('idle');
      
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Gagal memulihkan data');
      }

      setImportStatus('success');
    } catch (error: any) {
      console.error(error);
      setImportStatus('error');
      setErrorMessage(error.message || 'Terjadi kesalahan saat memulihkan data.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-20">
      {/* Header — Navy gradient */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Export Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-[#030C4D]/30 rounded-lg p-6 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 shrink-0 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center border border-emerald-200">
              <Download size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Buat Cadangan (Export)</h2>
          </div>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Unduh seluruh data sekolah Anda (Mata Pelajaran, Bank Soal, Gambar, Ujian, Jadwal, Nilai Siswa) dalam format <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs">.zip Full Archive</code>.
          </p>
          
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex gap-3">
            <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" size={18} />
            <div className="text-xs text-amber-800 font-medium leading-relaxed">
              File cadangan ini dilindungi dengan sistem anti-manipulasi. Jangan mencoba mengedit file konfigurasi di dalam ZIP karena akan membuat file *corrupt*.
            </div>
          </div>

          <button 
            onClick={handleExport}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 bg-[#030C4D] hover:bg-[#030C4D]/90 text-white py-3 rounded-lg font-bold transition-all disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="animate-spin" size={18} /> : <Database size={18} />}
            {isExporting ? 'Memproses Data & Mengunduh Gambar...' : 'Generate Backup Data'}
          </button>
        </motion.div>

        {/* Import Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white border border-red-200 rounded-lg p-6 shadow-sm relative overflow-hidden"
        >
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 shrink-0 bg-red-50 text-red-600 border border-red-200 rounded-lg flex items-center justify-center">
                <UploadCloud size={24} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Pulihkan Data (Restore)</h2>
            </div>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Unggah file <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs">.zip / .cbtbak</code> untuk mengembalikan data sekolah Anda beserta semua gambar pendukungnya.
            </p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
              <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={18} />
              <div className="text-xs text-red-800 font-bold leading-relaxed">
                PERINGATAN! Melakukan *restore* akan MENGHAPUS BERSIH data sekolah saat ini dan menimpanya dengan isi file *backup*. Lakukan ini HANYA jika akun sekolah Anda masih kosong!
              </div>
            </div>

            <div className="relative">
              <input 
                type="file" 
                accept=".cbtbak,.zip"
                onChange={handleFileChange}
                ref={fileInputRef}
                className="hidden" 
                id="file-upload"
                disabled={isImporting}
              />
              <label 
                htmlFor="file-upload"
                className={`w-full flex items-center justify-center gap-2 border-2 border-dashed ${isImporting ? 'border-slate-300 bg-slate-50 text-slate-400 cursor-not-allowed' : 'border-red-300 hover:border-red-500 hover:bg-red-50 text-red-600 cursor-pointer'} py-8 rounded-lg font-bold transition-all`}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Memulihkan Data... (Harap Tunggu)
                  </>
                ) : (
                  <>
                    <UploadCloud size={20} />
                    Pilih File .cbtbak atau .zip
                  </>
                )}
              </label>
            </div>

            {importStatus === 'success' && (
              <div className="mt-4 p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg flex items-start gap-2 text-sm font-medium">
                <CheckCircle2 className="shrink-0 mt-0.5" size={16} />
                Data berhasil dipulihkan! Silakan *refresh* halaman atau *logout* dan *login* kembali untuk melihat perubahan.
              </div>
            )}

            {importStatus === 'error' && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-start gap-2 text-sm font-medium">
                <XCircle className="shrink-0 mt-0.5" size={16} />
                {errorMessage}
              </div>
            )}

          </div>
        </motion.div>

      </div>
    </div>
  );
}
