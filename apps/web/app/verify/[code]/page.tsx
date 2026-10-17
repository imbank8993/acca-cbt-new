"use client";

import React, { useEffect, useState } from 'react';
import {
    AlertTriangle,
    Building2,
    Calendar,
    CheckCircle2,
    Clock,
    FileCheck2,
    FileText,
    Loader2,
    Search,
    ShieldAlert,
    ShieldCheck,
    UserCheck,
    Users,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import type { PASVerificationResult } from '@/lib/api/pas';

function formatLongDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(`${clean}T12:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

export default function VerifyPASDocumentPage() {
    const params = useParams();
    const router = useRouter();
    const rawCode = decodeURIComponent(String(params.code || '')).trim().toUpperCase();

    const [inputCode, setInputCode] = useState(rawCode);
    const [isLoading, setIsLoading] = useState(true);
    const [result, setResult] = useState<PASVerificationResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        setInputCode(rawCode);
        if (!rawCode) {
            setIsLoading(false);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        setErrorMessage(null);

        fetch(`/api/pas/verify/${encodeURIComponent(rawCode)}`, { cache: 'no-store' })
            .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok || !body?.verification) {
                    setResult(null);
                    setErrorMessage(body?.error || body?.message || 'Dokumen dengan kode verifikasi tersebut tidak ditemukan.');
                } else {
                    setResult(body.verification as PASVerificationResult);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setErrorMessage('Layanan verifikasi dokumen belum dapat dihubungi.');
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [rawCode]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const cleaned = inputCode.trim().toUpperCase();
        if (!cleaned) return;
        router.push(`/verify/${encodeURIComponent(cleaned)}`);
    };

    const isVerified = Boolean(result?.verified && result?.integrity_valid);

    return (
        <div className="min-h-screen bg-slate-50 py-10 px-4">
            <div className="max-w-2xl mx-auto space-y-5">
                {/* Search / Switch Verification Code Bar */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 text-[#3083FF] flex items-center justify-center shrink-0">
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <h1 className="text-sm font-bold text-slate-900">Portal Verifikasi Keaslian Dokumen PAS</h1>
                            <p className="text-[11px] text-slate-500">
                                Verifikasi Berita Acara (<code className="font-semibold">BA-PAS-...</code>) & Daftar Hadir (<code className="font-semibold">DH-PAS-...</code>)
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleSearch} className="flex items-center gap-2">
                        <div className="relative flex-1 sm:w-52">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={inputCode}
                                onChange={(e) => setInputCode(e.target.value)}
                                placeholder="BA-PAS-... / DH-PAS-..."
                                className="w-full h-9 pl-8 pr-3 text-xs font-mono uppercase bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            />
                        </div>
                        <button
                            type="submit"
                            className="h-9 px-3.5 rounded-xl bg-[#3083FF] hover:bg-blue-600 text-white text-xs font-bold transition-colors shrink-0"
                        >
                            Cek
                        </button>
                    </form>
                </div>

                {isLoading ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center space-y-3">
                        <Loader2 size={32} className="animate-spin text-[#3083FF] mx-auto" />
                        <p className="text-xs font-medium text-slate-500">
                            Memeriksa tanda tangan digital & integritas dokumen <strong className="font-mono">{rawCode}</strong>...
                        </p>
                    </div>
                ) : !result || errorMessage ? (
                    <div className="bg-white rounded-2xl border border-red-200 p-8 text-center space-y-3 shadow-2xs">
                        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
                            <ShieldAlert size={28} />
                        </div>
                        <h2 className="text-base font-bold text-slate-900">Dokumen Tidak Ditemukan / Belum Ditandatangani</h2>
                        <p className="text-xs text-slate-600 max-w-md mx-auto">
                            {errorMessage ||
                                `Kode verifikasi "${rawCode}" tidak terdaftar dalam basis data administrasi ujian PAS atau belum disimpan oleh Pengawas/Proktor.`}
                        </p>
                        <div className="pt-2">
                            <span className="inline-block px-3 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs font-bold">
                                {rawCode || '-'}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
                        {/* Status Banner */}
                        <div
                            className={`p-5 border-b flex items-start gap-3.5 ${
                                isVerified
                                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                                    : 'bg-amber-50 border-amber-200 text-amber-950'
                            }`}
                        >
                            <div
                                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                                    isVerified
                                        ? 'bg-emerald-600 text-white border-emerald-700'
                                        : 'bg-amber-500 text-white border-amber-600'
                                }`}
                            >
                                {isVerified ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                            isVerified
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-amber-600 text-white'
                                        }`}
                                    >
                                        {isVerified ? 'DOKUMEN ASLI & VALID' : 'PERINGATAN INTEGRITAS'}
                                    </span>
                                    <span className="text-xs font-mono font-bold text-slate-700">
                                        {result.verification_code}
                                    </span>
                                </div>
                                <h2 className="text-base font-bold mt-1">
                                    {result.document_label} ({result.period?.name})
                                </h2>
                                <p className="text-xs opacity-80 mt-0.5">
                                    {isVerified
                                        ? 'Dokumen ini tercatat resmi di sistem CBT dan tanda tangan digital SHA-256 cocok dengan data pelaksanaan ujian.'
                                        : 'Dokumen ditemukan tetapi hash integritas tidak cocok dengan catatan terakhir.'}
                                </p>
                            </div>
                        </div>

                        {/* Document Details */}
                        <div className="p-5 space-y-5 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Building2 size={11} /> Satuan Pendidikan & Periode
                                    </div>
                                    <div className="font-bold text-slate-900 text-sm">
                                        {result.organization_name}
                                    </div>
                                    <div className="text-slate-600">
                                        {result.period?.name} · TA {result.period?.school_year} ({result.period?.semester})
                                    </div>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Calendar size={11} /> Ruang, Sesi & Tanggal
                                    </div>
                                    <div className="font-bold text-slate-900 text-sm">
                                        {result.room?.name} — {result.session?.name}
                                    </div>
                                    <div className="text-slate-600 flex items-center gap-1.5">
                                        <Clock size={11} className="text-slate-400" />
                                        {result.session?.start_time?.substring(0, 5)} -{' '}
                                        {result.session?.end_time?.substring(0, 5)} · {formatLongDate(result.exam_date)}
                                    </div>
                                </div>
                            </div>

                            {/* Attendance Summary */}
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                                    <Users size={13} className="text-[#3083FF]" />
                                    Rekapitulasi Kehadiran Peserta Tercatat
                                </div>
                                <div className="grid grid-cols-5 gap-2 text-center">
                                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                                        <div className="text-[10px] font-semibold text-slate-500">Terdaftar</div>
                                        <div className="text-base font-bold text-slate-900 mt-0.5">
                                            {result.counts?.total ?? 0}
                                        </div>
                                    </div>
                                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                                        <div className="text-[10px] font-semibold text-emerald-700">Hadir</div>
                                        <div className="text-base font-bold text-emerald-800 mt-0.5">
                                            {result.counts?.hadir ?? 0}
                                        </div>
                                    </div>
                                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                                        <div className="text-[10px] font-semibold text-amber-700">Sakit</div>
                                        <div className="text-base font-bold text-amber-800 mt-0.5">
                                            {result.counts?.sakit ?? 0}
                                        </div>
                                    </div>
                                    <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
                                        <div className="text-[10px] font-semibold text-blue-700">Izin</div>
                                        <div className="text-base font-bold text-blue-800 mt-0.5">
                                            {result.counts?.izin ?? 0}
                                        </div>
                                    </div>
                                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200">
                                        <div className="text-[10px] font-semibold text-red-700">Alpha</div>
                                        <div className="text-base font-bold text-red-800 mt-0.5">
                                            {result.counts?.alpha ?? 0}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Signatories */}
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                                    <UserCheck size={13} className="text-[#3083FF]" />
                                    Pejabat Penandatangan Dokumen
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase text-slate-400">
                                                Pengawas Ruang Ujian
                                            </div>
                                            <div className="font-bold text-slate-900 text-sm mt-0.5">
                                                {result.invigilator_name || '-'}
                                            </div>
                                            <div className="text-[11px] text-slate-500">
                                                {result.room?.name} · {result.session?.name}
                                            </div>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                                            Tertandatangani
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase text-slate-400">
                                                Proktor
                                            </div>
                                            <div className="font-bold text-slate-900 text-sm mt-0.5">
                                                {result.proctor_name || '-'}
                                            </div>
                                            <div className="text-[11px] text-slate-500">Pembuat Folder Ujian</div>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                                            Tertandatangani
                                        </span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                                        <div className="text-[10px] font-bold uppercase text-slate-400">Mengetahui, Ketua Panitia</div>
                                        <div className="mt-0.5 text-sm font-bold text-slate-900">{result.committee_chair_name || 'Belum dicantumkan pada dokumen lama'}</div>
                                        {result.committee_chair_nip && <div className="mt-1 text-xs text-slate-500">NIP. {result.committee_chair_nip}</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Paired Document Switcher & Cryptographic Hash */}
                            <div className="rounded-xl bg-slate-900 text-slate-100 p-4 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                                        {result.document_type === 'berita_acara' ? (
                                            <FileText size={13} />
                                        ) : (
                                            <FileCheck2 size={13} />
                                        )}
                                        Sidik Jari Kriptografi (SHA-256)
                                    </span>
                                    <span className="text-[11px] text-slate-300">
                                        Waktu TTD: <strong>{formatDateTime(result.signed_at)}</strong>
                                    </span>
                                </div>
                                <div className="font-mono text-[11px] bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 break-all text-emerald-300">
                                    {result.signature_hash}
                                </div>
                                {result.paired_codes && (
                                    <div className="pt-1 flex items-center justify-between text-[11px] text-slate-300 flex-wrap gap-2">
                                        <span>Dokumen Pasangan pada Ruang & Sesi ini:</span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    router.push(
                                                        `/verify/${encodeURIComponent(result.paired_codes!.berita_acara)}`,
                                                    )
                                                }
                                                className={`px-2.5 py-1 rounded-md font-mono text-[11px] transition-colors ${
                                                    result.verification_code === result.paired_codes.berita_acara
                                                        ? 'bg-blue-600 text-white font-bold'
                                                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                                }`}
                                            >
                                                {result.paired_codes.berita_acara}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    router.push(
                                                        `/verify/${encodeURIComponent(result.paired_codes!.daftar_hadir)}`,
                                                    )
                                                }
                                                className={`px-2.5 py-1 rounded-md font-mono text-[11px] transition-colors ${
                                                    result.verification_code === result.paired_codes.daftar_hadir
                                                        ? 'bg-blue-600 text-white font-bold'
                                                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                                }`}
                                            >
                                                {result.paired_codes.daftar_hadir}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
