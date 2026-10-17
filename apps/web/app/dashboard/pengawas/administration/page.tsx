"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Building2,
    Calendar,
    CheckCircle2,
    Clock,
    FileCheck2,
    FileText,
    Loader2,
    RefreshCw,
    ShieldCheck,
    Users,
} from 'lucide-react';
import PASAdministrationPanel from '@/app/components/pas/PASAdministrationPanel';
import { listMyPASAssignments, type PASAssignmentSlotSummary } from '@/lib/api/pas';

export default function PengawasAdministrationPage() {
    const [assignments, setAssignments] = useState<PASAssignmentSlotSummary[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const loadAssignments = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const list = await listMyPASAssignments();
            setAssignments(list);
            setSelectedIndex((prev) => (prev < list.length ? prev : 0));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Daftar penugasan ruang & sesi belum dapat dimuat.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadAssignments();
    }, [loadAssignments]);

    const selectedAssignment = assignments[selectedIndex] || null;

    // Group rooms and sessions for the selected period so PASAdministrationPanel can switch smoothly
    const periodRooms = useMemo(() => {
        if (!selectedAssignment) return [];
        const map = new Map<string, { id: string; name: string; capacity?: number }>();
        for (const item of assignments) {
            if (item.period.id === selectedAssignment.period.id) {
                map.set(item.room.id, {
                    id: item.room.id,
                    name: item.room.name,
                    capacity: item.room.capacity,
                });
            }
        }
        return Array.from(map.values());
    }, [assignments, selectedAssignment]);

    const periodSessions = useMemo(() => {
        if (!selectedAssignment) return [];
        const map = new Map<string, { id: string; name: string; start_time: string; end_time: string }>();
        for (const item of assignments) {
            if (item.period.id === selectedAssignment.period.id) {
                map.set(item.session.id, {
                    id: item.session.id,
                    name: item.session.name,
                    start_time: item.session.start_time,
                    end_time: item.session.end_time,
                });
            }
        }
        return Array.from(map.values());
    }, [assignments, selectedAssignment]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Loader2 size={32} className="animate-spin text-[#3083FF]" />
                <p className="text-xs font-medium text-slate-500">Memuat penugasan ruang & sesi pengawas...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-5 pb-20">
            {/* ── Header ── */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 text-[#3083FF] flex items-center justify-center shrink-0">
                        <FileCheck2 size={20} />
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                            Administrasi Ujian PAS (Berita Acara & Daftar Hadir)
                        </h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Kelola absensi peserta (Hadir, Sakit, Izin, Alpha), isi Berita Acara berdasarkan Ruang & Sesi, serta cetak dokumen A4 berverifikasi QR.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void loadAssignments()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors self-start sm:self-auto"
                >
                    <RefreshCw size={13} />
                    Segarkan Penugasan
                </button>
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center justify-between">
                    <span>{error}</span>
                    <button type="button" onClick={() => void loadAssignments()} className="font-bold underline">
                        Coba Lagi
                    </button>
                </div>
            )}

            {assignments.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center space-y-2">
                    <AlertCircle size={36} className="mx-auto text-amber-500" />
                    <h2 className="text-sm font-bold text-slate-800">Belum Ada Penugasan Ruang & Sesi</h2>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Akun Anda belum dipetakan ke Ruang dan Sesi ujian PAS mana pun. Hubungi Proktor atau Admin untuk memetakan nama Anda pada tab <strong>Pengawas</strong> di periode ujian PAS.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Assigned Room × Session Cards ── */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                Pilih Ruang & Sesi Penugasan ({assignments.length} Slot)
                            </h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {assignments.map((item, idx) => {
                                const isSelected = idx === selectedIndex;
                                const signedCount = item.saved_reports.length;
                                return (
                                    <button
                                        key={`${item.period.id}-${item.room.id}-${item.session.id}`}
                                        type="button"
                                        onClick={() => setSelectedIndex(idx)}
                                        className={`text-left rounded-2xl border p-4 transition-all ${
                                            isSelected
                                                ? 'bg-blue-50/60 border-[#3083FF] ring-2 ring-[#3083FF]/15 shadow-xs'
                                                : 'bg-white border-slate-200/90 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                                                    {item.period.name}
                                                </span>
                                                <h3 className="text-sm font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
                                                    <Building2 size={14} className="text-[#3083FF]" />
                                                    {item.room.name} — {item.session.name}
                                                </h3>
                                            </div>
                                            {signedCount > 0 ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                                    <CheckCircle2 size={11} /> {signedCount} TTD
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                                                    <FileText size={11} /> Belum TTD
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-2.5 flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                                            <span className="inline-flex items-center gap-1">
                                                <Clock size={12} className="text-slate-400" />
                                                {item.session.start_time.substring(0, 5)} -{' '}
                                                {item.session.end_time.substring(0, 5)}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Users size={12} className="text-slate-400" />
                                                {item.room.student_count} Peserta
                                            </span>
                                            {item.scheduled_dates.length > 0 && (
                                                <span className="inline-flex items-center gap-1">
                                                    <Calendar size={12} className="text-slate-400" />
                                                    {item.scheduled_dates.length} Hari Terjadwal
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                                            <span className="truncate">
                                                Pengawas:{' '}
                                                <strong className="text-slate-700">
                                                    {item.invigilators.map((i) => i.full_name).join(', ') || '-'}
                                                </strong>
                                            </span>
                                            {item.is_assigned_to_me && (
                                                <span className="text-[#3083FF] font-bold shrink-0 ml-2 flex items-center gap-0.5">
                                                    <ShieldCheck size={12} /> Tugas Saya
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Active Administration Panel ── */}
                    {selectedAssignment && (
                        <PASAdministrationPanel
                            key={`${selectedAssignment.period.id}-${selectedAssignment.room.id}-${selectedAssignment.session.id}`}
                            period={selectedAssignment.period}
                            rooms={periodRooms}
                            sessions={periodSessions}
                            initialRoomId={selectedAssignment.room.id}
                            initialSessionId={selectedAssignment.session.id}
                            initialExamDate={selectedAssignment.scheduled_dates[0]}
                            onSlotSaved={() => void loadAssignments()}
                        />
                    )}
                </>
            )}
        </div>
    );
}
