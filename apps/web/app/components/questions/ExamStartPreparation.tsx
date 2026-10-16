"use client";

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Maximize2, ShieldCheck } from 'lucide-react';
import type { StudentExam } from '@/lib/api/students';
import { exitExamFullscreen, hasExamFullscreen, subscribeExamFullscreen, type FullscreenElement } from '@/lib/exam-fullscreen';

export function ExamStartPreparation({ exam, onConfirm, onBack, screenShare }: {
    exam: StudentExam;
    screenShare?: { sharing: boolean; busy: boolean; error: string; request: () => Promise<void> };
    onConfirm: (fullscreenReady: boolean) => void;
    onBack: () => void;
}) {
    const [ready, setReady] = useState(false);
    const [unsupported, setUnsupported] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const confirmedRef = useRef(false);
    const leavingRef = useRef(false);

    useEffect(() => {
        const changed = () => {
            if (!hasExamFullscreen()) setReady(false);
        };
        return subscribeExamFullscreen(changed);
    }, []);

    async function activateFullscreen() {
        setError('');
        const el = document.documentElement as FullscreenElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (!request) {
            setUnsupported(true);
            setReady(true);
            return;
        }
        setBusy(true);
        try {
            if (!hasExamFullscreen()) await request.call(el);
            if (leavingRef.current) { await exitExamFullscreen(); return; }
            if (!hasExamFullscreen()) throw new Error('fullscreen unavailable');
            setReady(true);
        } catch {
            setError('Layar penuh belum berhasil diaktifkan. Coba lagi dan izinkan layar penuh pada browser.');
        } finally {
            setBusy(false);
        }
    }

    function confirmStart() {
        if (confirmedRef.current || leavingRef.current || busy) return;
        if (exam.metadata?.screenshot_enabled === true && !screenShare?.sharing) {
            setError('Bagikan seluruh layar sebelum memulai ujian.');
            return;
        }
        if (!unsupported && !hasExamFullscreen()) {
            setReady(false);
            setError('Aktifkan kembali layar penuh sebelum memulai ujian.');
            return;
        }
        confirmedRef.current = true;
        onConfirm(true);
    }

    async function goBack() {
        if (leavingRef.current || confirmedRef.current || busy) return;
        leavingRef.current = true;
        setBusy(true);
        setError('');
        try {
            await exitExamFullscreen();
            onBack();
        } catch {
            leavingRef.current = false;
            setError('Layar penuh belum dapat ditutup. Tekan Esc atau gunakan tombol keluar layar penuh browser, lalu kembali ke jadwal.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-slate-100 p-6 dark:bg-[#020718]">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-[#0d1221] md:p-8">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                    {ready ? <ShieldCheck size={32} /> : <Maximize2 size={32} />}
                </div>
                <p className="mb-2 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">{exam.title}</p>
                <h1 className="mb-3 text-center text-2xl font-bold text-slate-800 dark:text-slate-100">
                    {ready ? 'Yakin ingin memulai ujian?' : 'Persiapan Ujian'}
                </h1>
                <p className="mb-5 text-center leading-relaxed text-slate-600 dark:text-slate-300">
                    {ready
                        ? 'Pastikan Anda sudah siap. Waktu akan mulai dihitung setelah Anda menekan “Ya, Mulai Ujian” dan server menerima permintaan.'
                        : 'Aktifkan layar penuh terlebih dahulu, lalu konfirmasikan bahwa Anda siap memulai ujian. Waktu pengerjaan belum berjalan.'}
                </p>
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle size={18} /> Durasi ujian: {exam.duration_minutes || 60} menit</p>
                    <p>Setelah dimulai, waktu terus berjalan meskipun halaman ditutup atau koneksi terputus. Waktu pengerjaan tetap dibatasi jadwal penutupan ujian.</p>
                </div>
                {exam.metadata?.screenshot_enabled === true && (
                    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        <p className="font-semibold">Berbagi seluruh layar wajib untuk ujian ini</p>
                        <p className="mt-1 text-xs">Screenshot hanya disimpan saat ada indikasi pelanggaran. Maksimal 10 gambar, masa simpan 7 hari, hanya dapat dibaca pengawas berwenang.</p>
                        <button type="button" disabled={screenShare?.busy} onClick={() => void screenShare?.request()}
                            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                            {screenShare?.sharing ? 'Layar sudah dibagikan' : screenShare?.busy ? 'Meminta izin...' : 'Bagikan Layar'}
                        </button>
                        {screenShare?.error && <p role="alert" className="mt-2 text-xs text-red-600">{screenShare.error}</p>}
                    </div>
                )}
                {unsupported && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Browser ini tidak mendukung layar penuh. Anda tetap dapat memulai ujian setelah konfirmasi.</p>}
                {error && <p role="alert" className="mb-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
                {ready ? (
                    <div className="flex flex-col gap-3">
                        <button onClick={confirmStart} disabled={busy || (exam.metadata?.screenshot_enabled === true && !screenShare?.sharing)} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-60">Ya, Mulai Ujian</button>
                        <button onClick={() => void goBack()} disabled={busy} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300 disabled:opacity-60">Belum, Kembali ke Jadwal</button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <button onClick={() => void activateFullscreen()} disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Mengaktifkan Layar Penuh...' : 'Aktifkan Layar Penuh'}</button>
                        <button onClick={() => void goBack()} disabled={busy} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300 disabled:opacity-60">Kembali ke Jadwal</button>
                    </div>
                )}
            </div>
        </div>
    );
}
