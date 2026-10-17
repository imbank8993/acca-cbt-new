"use client";

import React, { useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function VerifyIndexPage() {
    const router = useRouter();
    const [code, setCode] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const cleaned = code.trim().toUpperCase();
        if (!cleaned) return;
        router.push(`/verify/${encodeURIComponent(cleaned)}`);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 text-[#3083FF] flex items-center justify-center mx-auto">
                    <ShieldCheck size={24} />
                </div>
                <div>
                    <h1 className="text-base font-bold text-slate-900">
                        Verifikasi Keaslian Dokumen Ujian PAS
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                        Masukkan Kode Verifikasi yang tertera pada lembar A4 <strong>Berita Acara</strong> (<code>BA-PAS-...</code>) atau <strong>Daftar Hadir</strong> (<code>DH-PAS-...</code>).
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="relative">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Contoh: BA-PAS-20261017-A1B2C3D4"
                            className="w-full h-10 pl-9 pr-3 text-xs font-mono uppercase bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={!code.trim()}
                        className="w-full h-10 rounded-xl bg-[#3083FF] hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                    >
                        Verifikasi Dokumen
                    </button>
                </form>
            </div>
        </div>
    );
}
