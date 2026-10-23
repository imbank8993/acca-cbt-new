"use client";

import Image from 'next/image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Clock,
    Download,
    ExternalLink,
    FileCheck2,
    FileText,
    Loader2,
    Printer,
    QrCode,
    RefreshCw,
    Save,
    Search,
    Edit,
    ShieldCheck,
    UserCheck,
    Users,
    X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { drawAdministrationSigners } from '@/lib/pas/administration-signers';
import type { PASClassSchedule } from '@/app/types/pas';
import {
    approvePASAdministrationSlotAction,
    getPASAdministrationSlot,
    getPASPeriodAdministrationOverview,
    rejectPASAdministrationSlotAction,
    savePASAdministrationSlotAction,
    updatePASPeriodCommitteeChairAction,
    type PASAdministrationOverviewItem,
    type PASAdministrationSlot,
    type PASAttendanceStatus,
    type PASRoomMember,
} from '@/lib/api/pas';
import { formatKopParts, KOP_AND_A4_CSS, renderKopHTML, type ProfilSekolah } from '@/lib/pas/print-kop';
import { generateQrMatrix, generateQrSvgDataUrl } from '@/lib/pas/qr-svg';
import { schoolTodayDate } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';

export interface PASAdministrationPanelProps {
    period: {
        id: string;
        name: string;
        type?: string;
        school_year?: string;
        semester?: string;
        start_date?: string | null;
        end_date?: string | null;
        is_locked?: boolean;
        committee_chair_name?: string | null;
        committee_chair_nip?: string | null;
        profil_sekolah?: ProfilSekolah | null;
        pas_class_schedules?: PASClassSchedule[];
    };
    rooms: Array<{
        id: string;
        name: string;
        capacity?: number;
        pas_room_invigilators?: PASRoomMember[];
    }>;
    sessions: Array<{
        id: string;
        name: string;
        start_time: string;
        end_time: string;
    }>;
    initialRoomId?: string;
    initialSessionId?: string;
    initialExamDate?: string;
    openOnEditor?: boolean;
    userRole?: 'proktor' | 'admin' | 'pengawas';
    onSlotSaved?: (slot: PASAdministrationSlot) => void;
    onPeriodUpdated?: (chair: { committee_chair_name: string; committee_chair_nip: string | null }) => void;
}

type AdminSubView = 'overview' | 'editor' | 'berita_acara_a4' | 'daftar_hadir_a4';

interface StudentAttendanceDraft {
    status: PASAttendanceStatus;
    remark: string;
}

function hasNotableIncident(summary: string): boolean {
    const normalized = summary.trim().toLowerCase().replace(/[.!?]+$/, '');
    return normalized.length > 0 &&
        normalized !== 'tidak ada kendala atau insiden khusus selama pelaksanaan ujian' &&
        normalized !== 'tidak ada kendala teknis';
}

function formatIndonesianLongDate(dateStr: string | null | undefined): string {
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

function formatClockTime(isoOrTime: string | null | undefined, timeZone?: string): string {
    if (!isoOrTime) return '-';
    if (/^\d{2}:\d{2}/.test(isoOrTime) && !isoOrTime.includes('T')) {
        return isoOrTime.substring(0, 5);
    }
    const d = new Date(isoOrTime);
    if (Number.isNaN(d.getTime())) return '-';
    try {
        return d.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            ...(timeZone ? { timeZone } : {}),
        });
    } catch {
        return d.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }
}

function formatSignedTimestamp(iso: string | null | undefined, timeZone?: string): string {
    if (!iso) return 'Belum ditandatangani';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    try {
        return d.toLocaleString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            ...(timeZone ? { timeZone } : {}),
        });
    } catch {
        return d.toLocaleString('id-ID');
    }
}

function statusLabel(status: PASAttendanceStatus): string {
    switch (status) {
        case 'hadir':
            return 'Hadir';
        case 'sakit':
            return 'Sakit';
        case 'izin':
            return 'Izin';
        case 'alpha':
            return 'Alpha';
    }
}

function renderQrPngDataUrl(text: string, pixelSize = 240, margin = 2): string {
    const matrix = generateQrMatrix(text);
    const size = matrix.length;
    const totalModules = size + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelSize, pixelSize);
    ctx.fillStyle = '#0f172a';
    const scale = pixelSize / totalModules;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c]) {
                ctx.fillRect(
                    Math.floor((c + margin) * scale),
                    Math.floor((r + margin) * scale),
                    Math.ceil(scale),
                    Math.ceil(scale),
                );
            }
        }
    }
    return canvas.toDataURL('image/png');
}

function escapeHtml(value: string | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export default function PASAdministrationPanel({
    period,
    rooms,
    sessions,
    initialRoomId,
    initialSessionId,
    initialExamDate,
    openOnEditor = false,
    userRole,
    onSlotSaved,
    onPeriodUpdated,
}: PASAdministrationPanelProps) {
    const { timeZone } = useSchoolTimeZone();

    const resolvedRole: 'proktor' | 'admin' | 'pengawas' = useMemo(() => {
        if (userRole) return userRole;
        if (typeof window !== 'undefined' && window.location.pathname.includes('/pengawas/')) {
            return 'pengawas';
        }
        return 'proktor';
    }, [userRole]);

    const todayDate = useMemo(() => {
        const today = schoolTodayDate(timeZone);
        const start = period.start_date ? period.start_date.split('T')[0] : '';
        const end = period.end_date ? period.end_date.split('T')[0] : '';
        if (start && today < start) return start;
        if (end && today > end) return end;
        return today;
    }, [period.end_date, period.start_date, timeZone]);

    const [isChairModalOpen, setIsChairModalOpen] = useState(false);
    const [chairName, setChairName] = useState('');
    const [chairNip, setChairNip] = useState('');
    const [isSavingChair, setIsSavingChair] = useState(false);
    const [chairError, setChairError] = useState<string | null>(null);

    const [selectedRoomId, setSelectedRoomId] = useState<string>(initialRoomId || rooms[0]?.id || '');
    const [selectedSessionId, setSelectedSessionId] = useState<string>(initialSessionId || sessions[0]?.id || '');
    const [selectedDate, setSelectedDate] = useState<string>(initialExamDate || todayDate);
    const [subView, setSubView] = useState<AdminSubView>(() => {
        if (openOnEditor) return 'editor';
        if (initialRoomId) return 'editor';
        if (typeof window !== 'undefined' && window.location.pathname.includes('/pengawas/')) return 'editor';
        return 'overview';
    });
    const [studentSearch, setStudentSearch] = useState('');

    const [slot, setSlot] = useState<PASAdministrationSlot | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isPrintingSchedule, setIsPrintingSchedule] = useState(false);
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [rejectNote, setRejectNote] = useState('');
    const [rejectTarget, setRejectTarget] = useState<{ roomId: string; sessionId: string; examDate: string; roomName: string } | null>(null);

    const [overviewItems, setOverviewItems] = useState<PASAdministrationOverviewItem[]>([]);
    const [isLoadingOverview, setIsLoadingOverview] = useState(false);
    const [overviewError, setOverviewError] = useState<string | null>(null);

    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveNotice, setSaveNotice] = useState<string | null>(null);
    const loadRequestRef = useRef(0);
    const incidentSlotKeyRef = useRef('');

    // Form state
    const [notes, setNotes] = useState('');
    const [incidentSummary, setIncidentSummary] = useState('');
    const [showIncidentDetails, setShowIncidentDetails] = useState(false);
    const invigilatorName = slot?.invigilators.map(inv => inv.full_name).filter(Boolean).join(', ')
        || slot?.report.invigilator_name || '';
    const proctorName = slot?.proctor_creator.full_name || '';
    const [attendanceMap, setAttendanceMap] = useState<Record<string, StudentAttendanceDraft>>({});

    // Keep incoming navigation targets in sync without an extra effect render.
    const [previousTargets, setPreviousTargets] = useState({ initialRoomId, initialSessionId, initialExamDate });
    if (previousTargets.initialRoomId !== initialRoomId || previousTargets.initialSessionId !== initialSessionId || previousTargets.initialExamDate !== initialExamDate) {
        setPreviousTargets({ initialRoomId, initialSessionId, initialExamDate });
        if (initialRoomId) setSelectedRoomId(initialRoomId);
        if (initialSessionId) setSelectedSessionId(initialSessionId);
        if (initialExamDate) setSelectedDate(initialExamDate);
    }
    if (!selectedRoomId && rooms[0]?.id) setSelectedRoomId(rooms[0].id);
    if (!selectedSessionId && sessions[0]?.id) setSelectedSessionId(sessions[0].id);

    const applySlotState = useCallback((data: PASAdministrationSlot) => {
        setSlot(data);
        setNotes(data.report.notes || '');
        setIncidentSummary(data.report.incident_summary || '');
        const incidentSlotKey = `${data.room.id}:${data.session.id}:${data.exam_date}`;
        if (incidentSlotKeyRef.current !== incidentSlotKey) {
            setShowIncidentDetails(hasNotableIncident(data.report.incident_summary || ''));
            incidentSlotKeyRef.current = incidentSlotKey;
        }
        const nextMap: Record<string, StudentAttendanceDraft> = {};
        for (const st of data.students) {
            nextMap[st.user_id] = {
                status: st.attendance_status || 'hadir',
                remark: st.remark || '',
            };
        }
        setAttendanceMap(nextMap);
    }, []);

    const loadSlot = useCallback(async () => {
        if (!period.id || !selectedRoomId || !selectedSessionId) return;
        const reqId = ++loadRequestRef.current;
        setIsLoading(true);
        setLoadError(null);
        setSaveNotice(null);
        try {
            const data = await getPASAdministrationSlot({
                periodId: period.id,
                roomId: selectedRoomId,
                sessionId: selectedSessionId,
                examDate: selectedDate || undefined,
            });
            if (reqId !== loadRequestRef.current) return;
            applySlotState(data);
        } catch (err) {
            if (reqId !== loadRequestRef.current) return;
            setLoadError(err instanceof Error ? err.message : 'Data administrasi ruang dan sesi belum dapat dimuat.');
        } finally {
            if (reqId === loadRequestRef.current) {
                setIsLoading(false);
            }
        }
    }, [applySlotState, period.id, selectedDate, selectedRoomId, selectedSessionId]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadSlot(), 0);
        return () => {
            window.clearTimeout(timer);
            loadRequestRef.current += 1;
        };
    }, [loadSlot]);

    const loadOverview = useCallback(async () => {
        if (!period.id) return;
        setIsLoadingOverview(true);
        setOverviewError(null);
        try {
            const data = await getPASPeriodAdministrationOverview(period.id);
            setOverviewItems(data);
        } catch (err) {
            setOverviewError(err instanceof Error ? err.message : 'Gagal memuat rekapitulasi administrasi.');
        } finally {
            setIsLoadingOverview(false);
        }
    }, [period.id]);

    useEffect(() => {
        if (resolvedRole === 'pengawas') return;
        const timer = window.setTimeout(() => void loadOverview(), 0);
        return () => window.clearTimeout(timer);
    }, [loadOverview, resolvedRole]);

    const openChairModal = () => {
        setChairName(slot?.committee_chair?.committee_chair_name || period.committee_chair_name || '');
        setChairNip(slot?.committee_chair?.committee_chair_nip || period.committee_chair_nip || '');
        setChairError(null);
        setIsChairModalOpen(true);
    };

    const handleSaveCommitteeChair = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = chairName.trim();
        if (!trimmed) {
            setChairError('Nama Ketua Panitia wajib diisi.');
            return;
        }
        setIsSavingChair(true);
        setChairError(null);
        try {
            const res = await updatePASPeriodCommitteeChairAction(period.id, {
                committee_chair_name: trimmed,
                committee_chair_nip: chairNip.trim() || undefined,
            });
            if (!res.success) {
                setChairError(res.error || 'Gagal menyimpan nama Ketua Panitia.');
                return;
            }
            setIsChairModalOpen(false);
            onPeriodUpdated?.({
                committee_chair_name: res.committee_chair_name,
                committee_chair_nip: res.committee_chair_nip,
            });
            await loadSlot();
        } catch (err) {
            setChairError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan.');
        } finally {
            setIsSavingChair(false);
        }
    };

    const updateStudentStatus = (userId: string, status: PASAttendanceStatus) => {
        setAttendanceMap((prev) => ({
            ...prev,
            [userId]: {
                status,
                remark: prev[userId]?.remark || '',
            },
        }));
    };

    const updateStudentRemark = (userId: string, remark: string) => {
        setAttendanceMap((prev) => ({
            ...prev,
            [userId]: {
                status: prev[userId]?.status || 'hadir',
                remark,
            },
        }));
    };

    const markAllHadir = () => {
        if (!slot) return;
        const next: Record<string, StudentAttendanceDraft> = {};
        for (const st of slot.students) {
            next[st.user_id] = {
                status: 'hadir',
                remark: attendanceMap[st.user_id]?.remark || '',
            };
        }
        setAttendanceMap(next);
    };

    const syncFromExamActivity = () => {
        if (!slot) return;
        const next: Record<string, StudentAttendanceDraft> = {};
        for (const st of slot.students) {
            const existing = attendanceMap[st.user_id];
            const hasStarted = Boolean(st.started_at);
            next[st.user_id] = {
                status: hasStarted ? 'hadir' : existing?.status && existing.status !== 'hadir' ? existing.status : 'alpha',
                remark: existing?.remark || '',
            };
        }
        setAttendanceMap(next);
    };

    const liveCounts = useMemo(() => {
        const students = slot?.students || [];
        let hadir = 0;
        let sakit = 0;
        let izin = 0;
        let alpha = 0;
        for (const st of students) {
            const status = attendanceMap[st.user_id]?.status || st.attendance_status || 'hadir';
            if (status === 'hadir') hadir++;
            else if (status === 'sakit') sakit++;
            else if (status === 'izin') izin++;
            else if (status === 'alpha') alpha++;
        }
        return {
            total: students.length,
            hadir,
            sakit,
            izin,
            alpha,
        };
    }, [attendanceMap, slot?.students]);

    const filteredStudents = useMemo(() => {
        const list = slot?.students || [];
        const q = studentSearch.trim().toLowerCase();
        if (!q) return list;
        return list.filter(
            (st) =>
                st.full_name.toLowerCase().includes(q) ||
                st.nis.toLowerCase().includes(q) ||
                st.class_name.toLowerCase().includes(q),
        );
    }, [slot?.students, studentSearch]);

    const pendingApprovalCount = useMemo(() => {
        return overviewItems.filter((i) => i.status === 'submitted').length;
    }, [overviewItems]);

    const handleSaveSlot = async (
        action: 'save_draft' | 'submit' | 'approve' = 'save_draft',
        silent = false,
    ): Promise<PASAdministrationSlot | null> => {
        if (!slot || !selectedRoomId || !selectedSessionId || !selectedDate) return null;

        if (!slot.committee_chair?.committee_chair_name && !period.committee_chair_name) {
            if (!silent) {
                await alertDialog({
                    title: 'Ketua Panitia Belum Diatur',
                    text: 'Nama Ketua Panitia belum diatur untuk folder ujian ini. Silakan atur nama Ketua Panitia terlebih dahulu sebelum menandatangani Berita Acara dan Daftar Hadir.',
                    variant: 'warning',
                });
                openChairModal();
            }
            return null;
        }

        if (action === 'submit' && !silent) {
            const confirmSubmit = await confirmDialog({
                title: 'Kirim Dokumen ke Proktor?',
                text: 'Berita Acara dan Daftar Hadir ini akan diserahkan ke Proktor / Pembuat Ujian untuk diperiksa dan di-ACC menjadi dokumen resmi.',
                confirmText: 'Ya, Kirim ke Proktor',
                cancelText: 'Batal',
                variant: 'info',
            });
            if (!confirmSubmit) return null;
        }

        setIsSaving(true);
        setSaveNotice(null);
        try {
            const attendances = slot.students.map((st) => ({
                user_id: st.user_id,
                status: attendanceMap[st.user_id]?.status || st.attendance_status || 'hadir',
                remark: attendanceMap[st.user_id]?.remark || '',
            }));

            const res = await savePASAdministrationSlotAction({
                pas_period_id: period.id,
                pas_room_id: selectedRoomId,
                session_id: selectedSessionId,
                exam_date: selectedDate,
                notes,
                incident_summary: incidentSummary,
                action,
                attendances,
            });

            if (!res.success) {
                if (!silent) {
                    await alertDialog({
                        title: 'Gagal Menyimpan Administrasi',
                        text: res.error || 'Perubahan Berita Acara dan Daftar Hadir belum dapat disimpan.',
                        variant: 'danger',
                    });
                    if (res.error?.includes('Ketua Panitia')) {
                        openChairModal();
                    }
                }
                return null;
            }

            if (!res.slot) {
                return null;
            }

            applySlotState(res.slot);
            if (action === 'submit') {
                setSaveNotice('Berita Acara & Daftar Hadir berhasil dikirim ke Proktor. Status saat ini: Menunggu ACC Proktor.');
            } else if (action === 'approve') {
                setSaveNotice('Berita Acara & Daftar Hadir berhasil disahkan (ACC) menjadi dokumen resmi.');
            } else {
                setSaveNotice('Draft Berita Acara & Daftar Hadir berhasil disimpan.');
            }
            onSlotSaved?.(res.slot);
            void loadOverview();
            return res.slot;
        } finally {
            setIsSaving(false);
        }
    };

    const handleApproveSlot = async (target?: { roomId: string; sessionId: string; examDate: string }) => {
        const rId = target?.roomId || selectedRoomId;
        const sId = target?.sessionId || selectedSessionId;
        const eDate = target?.examDate || selectedDate;
        if (!rId || !sId || !eDate) return;

        const ok = await confirmDialog({
            title: 'ACC Dokumen Resmi?',
            text: 'Dokumen Berita Acara dan Daftar Hadir akan disahkan menjadi dokumen resmi dengan tanda tangan digital dan QR code verifikasi publik.',
            confirmText: 'Ya, Sahkan (ACC)',
            cancelText: 'Batal',
            variant: 'info',
        });
        if (!ok) return;

        setIsApproving(true);
        try {
            const res = await approvePASAdministrationSlotAction({
                pas_period_id: period.id,
                pas_room_id: rId,
                session_id: sId,
                exam_date: eDate,
            });
            if (!res.success) {
                await alertDialog({
                    title: 'Gagal Menyetujui',
                    text: res.error || 'Terjadi kesalahan saat menyetujui dokumen.',
                    variant: 'danger',
                });
                return;
            }
            if (res.slot && rId === selectedRoomId && sId === selectedSessionId && eDate === selectedDate) {
                applySlotState(res.slot);
            }
            setSaveNotice('Dokumen berhasil disetujui (ACC) dan disahkan secara resmi.');
            await loadOverview();
        } finally {
            setIsApproving(false);
        }
    };

    const handleOpenRejectModal = (target?: { roomId: string; sessionId: string; examDate: string; roomName: string }) => {
        setRejectTarget(
            target || {
                roomId: selectedRoomId,
                sessionId: selectedSessionId,
                examDate: selectedDate,
                roomName: slot?.room.name || 'Ruang',
            },
        );
        setRejectNote('');
        setIsRejectModalOpen(true);
    };

    const handleConfirmReject = async () => {
        if (!rejectTarget) return;
        setIsRejecting(true);
        try {
            const res = await rejectPASAdministrationSlotAction({
                pas_period_id: period.id,
                pas_room_id: rejectTarget.roomId,
                session_id: rejectTarget.sessionId,
                exam_date: rejectTarget.examDate,
                rejection_note: rejectNote.trim() || 'Perlu perbaikan oleh pengawas ruang',
            });
            if (!res.success) {
                await alertDialog({
                    title: 'Gagal Mengembalikan',
                    text: res.error || 'Terjadi kesalahan saat mengembalikan dokumen.',
                    variant: 'danger',
                });
                return;
            }
            setIsRejectModalOpen(false);
            if (
                rejectTarget.roomId === selectedRoomId &&
                rejectTarget.sessionId === selectedSessionId &&
                rejectTarget.examDate === selectedDate
            ) {
                if (res.slot) applySlotState(res.slot);
            }
            setSaveNotice('Dokumen telah dikembalikan ke pengawas ruang dengan catatan perbaikan.');
            await loadOverview();
        } finally {
            setIsRejecting(false);
        }
    };

    const getVerificationUrl = (code: string) => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return `${origin}/verify/${encodeURIComponent(code)}`;
    };

    const hasDocumentChanges = slot ? notes !== slot.report.notes || incidentSummary !== slot.report.incident_summary ||
        invigilatorName !== slot.report.invigilator_name ||
        slot.students.some(student => {
            const draft = attendanceMap[student.user_id];
            return (draft?.status || 'hadir') !== student.attendance_status || (draft?.remark || '') !== (student.remark || '');
        }) : false;

    const prepareDocument = async () => {
        if (slot?.report.status === 'approved' && slot.report.signature_version >= 3 &&
            slot.report.integrity_valid !== false && !hasDocumentChanges) return slot;
        await alertDialog({ title: 'Dokumen Belum Siap Dicetak',
            text: 'Simpan dan kirim perubahan, lalu minta Proktor melakukan ACC. Dokumen lama perlu diperiksa dan di-ACC ulang sebelum dicetak sebagai dokumen resmi.',
            variant: 'warning' });
        return null;
    };

    const baVerificationCode = slot?.report.verification_code || '';
    const dhVerificationCode = slot?.report.attendance_verification_code || '';

    const baQrSvgUrl = useMemo(
        () => (baVerificationCode ? generateQrSvgDataUrl(getVerificationUrl(baVerificationCode)) : ''),
        [baVerificationCode],
    );

    const dhQrSvgUrl = useMemo(
        () => (dhVerificationCode ? generateQrSvgDataUrl(getVerificationUrl(dhVerificationCode)) : ''),
        [dhVerificationCode],
    );

    const subjectSummaryLabel = useMemo(() => {
        if (!slot?.schedules?.length) return 'Sesuai Jadwal Ujian';
        const names = Array.from(new Set(slot.schedules.map((s) => s.subject_name).filter(Boolean)));
        return names.join(', ') || 'Sesuai Jadwal Ujian';
    }, [slot]);

    const classSummaryLabel = useMemo(() => {
        if (!slot) return '-';
        const fromStudents = Array.from(
            new Set(slot.students.map((s) => s.class_name).filter((c) => c && c !== '-')),
        );
        if (fromStudents.length > 0) return fromStudents.join(', ');
        const fromSchedules = Array.from(
            new Set(slot.schedules.map((s) => s.class_name).filter((c) => c && c !== '-')),
        );
        return fromSchedules.length > 0 ? fromSchedules.join(', ') : '-';
    }, [slot]);

    const absentStudents = useMemo(() => {
        if (!slot) return [];
        return slot.students
            .map((st) => {
                const draft = attendanceMap[st.user_id];
                const status = draft?.status || st.attendance_status || 'hadir';
                const remark = draft?.remark ?? st.remark ?? '';
                return { ...st, effectiveStatus: status, effectiveRemark: remark };
            })
            .filter((st) => st.effectiveStatus !== 'hadir');
    }, [attendanceMap, slot]);

    const kopParts = useMemo(
        () =>
            formatKopParts(
                slot?.profil_sekolah || {
                    nama: slot?.period.organization_name || 'MAN INSAN CENDEKIA GOWA',
                    jenjang: 'MA',
                },
            ),
        [slot?.period.organization_name, slot?.profil_sekolah],
    );

    const verifiedBadgeSvgHtml =
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="#2563eb" style="display:inline-block; vertical-align:middle; margin-right:4px; flex-shrink:0;"><path d="M10.067.87a2.89 2.89 0 0 0-4.134 0l-.622.638-.89-.011a2.89 2.89 0 0 0-2.924 2.924l.01.89-.636.622a2.89 2.89 0 0 0 0 4.134l.637.622-.011.89a2.89 2.89 0 0 0 2.924 2.924l.89-.01.622.636a2.89 2.89 0 0 0 4.134 0l.622-.637.89.011a2.89 2.89 0 0 0 2.924-2.924l-.01-.89.636-.622a2.89 2.89 0 0 0 0-4.134l-.637-.622.011-.89a2.89 2.89 0 0 0-2.924-2.924l-.89.01zm.287 5.984-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7 8.793l2.646-2.647a.5.5 0 0 1 .708.708"/></svg>';

    const handlePrintA4 = async (docType: 'berita_acara' | 'daftar_hadir') => {
        if (!slot) return;
        const currentSlot = await prepareDocument();
        if (!currentSlot) return;

        const code =
            docType === 'berita_acara'
                ? currentSlot.report.verification_code
                : currentSlot.report.attendance_verification_code;
        const verifyUrl = getVerificationUrl(code);
        const qrSvg = generateQrSvgDataUrl(verifyUrl);
        const signedAtText = formatSignedTimestamp(currentSlot.report.signed_at || new Date().toISOString(), timeZone);
        const dateLong = formatIndonesianLongDate(currentSlot.exam_date);
        const sessionTime = `${currentSlot.session.start_time.substring(0, 5)} - ${currentSlot.session.end_time.substring(0, 5)}`;
        const effectiveInvName = currentSlot.report.invigilator_name || '-';
        const effectiveInvNip = currentSlot.report.invigilator_nip || '';
        const effectiveProcName = currentSlot.report.proctor_name || '-';
        const effectiveChairName = currentSlot.report.committee_chair_name || '-';
        const effectiveChairNip = currentSlot.report.committee_chair_nip || '';
        const effectiveProcNip = currentSlot.report.proctor_nip || '';

        const kopHtml = renderKopHTML(
            currentSlot.profil_sekolah || {
                nama: currentSlot.period.organization_name,
                jenjang: 'MA',
            },
        );

        const rowsHtml = currentSlot.students
            .map((st, idx) => {
                const draft = attendanceMap[st.user_id];
                const stStatus = draft?.status || st.attendance_status || 'hadir';
                const stRemark = draft?.remark ?? st.remark ?? '';
                const startClock = formatClockTime(st.started_at, timeZone);
                const endClock = formatClockTime(st.finished_at, timeZone);
                return `
                    <tr>
                        <td style="text-align:center;width:5%;">${idx + 1}</td>
                        <td style="width:14%;white-space:nowrap;">${escapeHtml(st.nis)}</td>
                        <td style="width:28%;">${escapeHtml(st.full_name)}</td>
                        <td style="width:12%;text-align:center;white-space:nowrap;">${escapeHtml(st.class_name)}</td>
                        <td style="width:16%;text-align:center;white-space:nowrap;">${escapeHtml(startClock)} - ${escapeHtml(endClock)}</td>
                        <td style="width:10%;text-align:center;font-weight:bold;">${escapeHtml(statusLabel(stStatus))}</td>
                        <td>${escapeHtml(stRemark || '-')}</td>
                    </tr>
                `;
            })
            .join('');

        const absentRowsHtml =
            absentStudents.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#555;padding:10px;">Seluruh peserta hadir (${liveCounts.total} peserta).</td></tr>`
                : absentStudents
                      .map(
                          (st, idx) => `
                    <tr>
                        <td style="text-align:center;width:6%;">${idx + 1}</td>
                        <td style="width:16%;white-space:nowrap;">${escapeHtml(st.nis)}</td>
                        <td style="width:34%;">${escapeHtml(st.full_name)}</td>
                        <td style="width:14%;text-align:center;white-space:nowrap;">${escapeHtml(st.class_name)}</td>
                        <td><strong>${escapeHtml(statusLabel(st.effectiveStatus))}</strong>${st.effectiveRemark ? ` — ${escapeHtml(st.effectiveRemark)}` : ''}</td>
                    </tr>
                `,
                      )
                      .join('');

        const bodyContent =
            docType === 'berita_acara'
                ? `
                <div class="doc-title"><h1>BERITA ACARA PELAKSANAAN UJIAN</h1></div>
                <div class="doc-sub">Periode : <strong>${escapeHtml(currentSlot.period.name)} — TA ${escapeHtml(currentSlot.period.school_year || '-')} (${escapeHtml(currentSlot.period.semester || '-')})</strong></div>

                <table class="meta-table">
                    <tr><td>Hari / Tanggal</td><td>:</td><td>${escapeHtml(dateLong)}</td></tr>
                    <tr><td>Ruang &amp; Sesi Ujian</td><td>:</td><td>${escapeHtml(currentSlot.room.name)} · ${escapeHtml(currentSlot.session.name)} (${escapeHtml(sessionTime)})</td></tr>
                    <tr><td>Mata Pelajaran</td><td>:</td><td>${escapeHtml(subjectSummaryLabel)}</td></tr>
                    <tr><td>Kelas Peserta</td><td>:</td><td>${escapeHtml(classSummaryLabel)}</td></tr>
                    <tr><td>Pengawas Ruang</td><td>:</td><td>${escapeHtml(effectiveInvName)}</td></tr>
                    <tr><td>Status Dokumen</td><td>:</td><td><span class="status-text">${verifiedBadgeSvgHtml}Disahkan</span></td></tr>
                </table>

                <p class="narrative">
                    Pada hari ini <strong>${escapeHtml(dateLong)}</strong>, telah dilaksanakan
                    <strong>${escapeHtml(currentSlot.period.name)}</strong> secara Computer-Based Test (CBT) pada
                    <strong>${escapeHtml(currentSlot.room.name)}</strong> (${escapeHtml(currentSlot.session.name)}, pukul ${escapeHtml(sessionTime)})
                    dengan rincian kehadiran peserta dan catatan pelaksanaan sebagai berikut:
                </p>

                <div class="section-heading">I. Rekapitulasi Kehadiran Peserta</div>
                <table class="entries">
                    <thead>
                        <tr>
                            <th>Peserta Terdaftar</th>
                            <th>Hadir</th>
                            <th>Sakit</th>
                            <th>Izin</th>
                            <th>Tanpa Keterangan (Alpha)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="text-align:center;font-weight:bold;font-size:10.5pt;">${liveCounts.total}</td>
                            <td style="text-align:center;font-weight:bold;font-size:10.5pt;">${liveCounts.hadir}</td>
                            <td style="text-align:center;font-weight:bold;font-size:10.5pt;">${liveCounts.sakit}</td>
                            <td style="text-align:center;font-weight:bold;font-size:10.5pt;">${liveCounts.izin}</td>
                            <td style="text-align:center;font-weight:bold;font-size:10.5pt;">${liveCounts.alpha}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="section-heading">II. Daftar Peserta Tidak Hadir (Sakit / Izin / Alpha)</div>
                <table class="entries">
                    <thead>
                        <tr>
                            <th style="width:6%;">No</th>
                            <th style="width:16%;">NIS</th>
                            <th style="width:34%;">Nama Peserta</th>
                            <th style="width:14%;">Kelas</th>
                            <th>Status &amp; Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${absentRowsHtml}
                    </tbody>
                </table>

                <div class="section-heading">III. Catatan Pelaksanaan &amp; Kejadian Khusus</div>
                <div class="notes-box">
                    <div><strong>Catatan Pelaksanaan:</strong> ${escapeHtml(notes || 'Pelaksanaan ujian berjalan tertib, aman, dan lancar.')}</div>
                    <div style="margin-top:4px;"><strong>Kejadian Khusus / Kendala Teknis:</strong> ${escapeHtml(incidentSummary || 'Tidak ada kendala teknis.')}</div>
                </div>
            `
                : `
                <div class="doc-title"><h1>DAFTAR HADIR PESERTA UJIAN</h1></div>
                <div class="doc-sub">Periode : <strong>${escapeHtml(currentSlot.period.name)} — TA ${escapeHtml(currentSlot.period.school_year || '-')} (${escapeHtml(currentSlot.period.semester || '-')})</strong></div>

                <table class="meta-table">
                    <tr><td>Hari / Tanggal</td><td>:</td><td>${escapeHtml(dateLong)}</td></tr>
                    <tr><td>Ruang &amp; Sesi Ujian</td><td>:</td><td>${escapeHtml(currentSlot.room.name)} · ${escapeHtml(currentSlot.session.name)} (${escapeHtml(sessionTime)})</td></tr>
                    <tr><td>Mata Pelajaran</td><td>:</td><td>${escapeHtml(subjectSummaryLabel)}</td></tr>
                    <tr><td>Rekap Kehadiran</td><td>:</td><td>Terdaftar: ${liveCounts.total} · Hadir: ${liveCounts.hadir} · Sakit: ${liveCounts.sakit} · Izin: ${liveCounts.izin} · Alpha: ${liveCounts.alpha}</td></tr>
                    <tr><td>Status Dokumen</td><td>:</td><td><span class="status-text">${verifiedBadgeSvgHtml}Disahkan</span></td></tr>
                </table>

                <table class="entries">
                    <thead>
                        <tr>
                            <th style="width:5%;">No</th>
                            <th style="width:14%;">NIS</th>
                            <th style="width:28%;">Nama Peserta</th>
                            <th style="width:12%;">Kelas</th>
                            <th style="width:16%;">Mulai - Selesai</th>
                            <th style="width:10%;">Status</th>
                            <th>Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            rowsHtml ||
                            `<tr><td colspan="7" style="text-align:center;padding:10px;">Tidak ada data peserta di ruang ini</td></tr>`
                        }
                    </tbody>
                </table>
            `;

        const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${docType === 'berita_acara' ? 'Berita Acara Ujian' : 'Daftar Hadir Peserta'} - ${escapeHtml(currentSlot.room.name)} - ${escapeHtml(currentSlot.session.name)}</title>
<style>
${KOP_AND_A4_CSS}
</style>
</head>
<body>
  <div class="page">
    ${kopHtml}
    ${bodyContent}

    <div class="approval-footer">
      <table class="ttd-table">
        <tbody>
          <tr><td>Disahkan pada</td><td>:</td><td>${escapeHtml(signedAtText)}</td></tr>
          <tr>
            <td>Pengawas Ruang</td>
            <td>:</td>
            <td>
              ${escapeHtml(effectiveInvName)}
              ${effectiveInvNip && effectiveInvNip !== '-' ? `<br/><span class="ttd-nip">NIP. ${escapeHtml(effectiveInvNip)}</span>` : ''}
            </td>
          </tr>
          <tr>
            <td>Proktor</td>
            <td>:</td>
            <td>
              ${escapeHtml(effectiveProcName)}
              ${effectiveProcNip && effectiveProcNip !== '-' ? `<br/><span class="ttd-nip">NIP. ${escapeHtml(effectiveProcNip)}</span>` : ''}
            </td>
          </tr>
          <tr>
            <td>Mengetahui,<br/>Ketua Panitia</td><td>:</td>
            <td>
              ${escapeHtml(effectiveChairName)}
              ${effectiveChairNip ? `<br/><span class="ttd-nip">NIP. ${escapeHtml(effectiveChairNip)}</span>` : ''}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="verify-wrap">
        <img class="verify-qr" src="${qrSvg}" alt="QR Verifikasi" />
        <div class="verify-label">Pindai untuk verifikasi keaslian dokumen</div>
        <div class="verify-id">${escapeHtml(code)}</div>
      </div>
    </div>
  </div>
  <script>
    window.onload = function() {
      var imgs = Array.prototype.slice.call(document.images || []);
      Promise.all(imgs.map(function(img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function(resolve) {
          img.onload = resolve;
          img.onerror = resolve;
        });
      })).then(function() {
        setTimeout(function() { window.print(); }, 200);
      });
    };
  </script>
</body>
</html>`;

        const win = window.open('', '_blank', 'width=900,height=1100');
        if (!win) {
            await alertDialog({
                title: 'Pop-up Diblokir Browser',
                text: 'Izinkan pop-up pada browser untuk membuka jendela cetak A4, atau gunakan tombol Unduh PDF A4.',
                variant: 'warning',
            });
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    const handleDownloadPdfA4 = async (docType: 'berita_acara' | 'daftar_hadir') => {
        if (!slot) return;
        const currentSlot = await prepareDocument();
        if (!currentSlot) return;

        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = 210;
        const marginLeft = 20;
        const marginRight = 15;
        const contentW = pageW - marginLeft - marginRight;
        let y = 12;

        const code =
            docType === 'berita_acara'
                ? currentSlot.report.verification_code
                : currentSlot.report.attendance_verification_code;
        const verifyUrl = getVerificationUrl(code);
        const qrPngUrl = renderQrPngDataUrl(verifyUrl, 240, 1);
        const dateLong = formatIndonesianLongDate(currentSlot.exam_date);
        const sessionTime = `${currentSlot.session.start_time.substring(0, 5)} - ${currentSlot.session.end_time.substring(0, 5)}`;
        const signedAtText = formatSignedTimestamp(currentSlot.report.signed_at || new Date().toISOString(), timeZone);
        const effectiveInvName = currentSlot.report.invigilator_name || '-';
        const effectiveInvNip = currentSlot.report.invigilator_nip || '';
        const effectiveProcName = currentSlot.report.proctor_name || '-';
        const effectiveChairName = currentSlot.report.committee_chair_name || '-';
        const effectiveChairNip = currentSlot.report.committee_chair_nip || '';
        const effectiveProcNip = currentSlot.report.proctor_nip || '';

        const kParts = formatKopParts(
            currentSlot.profil_sekolah || {
                nama: currentSlot.period.organization_name,
                jenjang: 'MA',
            },
        );

        // Try loading school logo for KOP if available
        if (kParts.logoUrl) {
            try {
                const resp = await fetch(kParts.logoUrl, { mode: 'cors' });
                if (resp.ok) {
                    const blob = await resp.blob();
                    const logoDataUrl = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                        reader.onerror = () => resolve('');
                        reader.readAsDataURL(blob);
                    });
                    if (logoDataUrl) {
                        const imgFormat = logoDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
                        pdf.addImage(logoDataUrl, imgFormat, marginLeft, 10, 21, 21);
                    }
                }
            } catch {
                // Continue gracefully without logo if blocked by CORS
            }
        }

        // KOP Sekolah (sama dengan KOP Laporan Guru Asuh pada acca-new)
        const centerX = marginLeft + contentW / 2;
        pdf.setFont('times', 'bold');
        if (kParts.isMadrasah) {
            pdf.setFontSize(11.5);
            pdf.text(kParts.kemenagLine1, centerX, y, { align: 'center' });
            y += 4.8;
            pdf.text(kParts.kemenagLine2, centerX, y, { align: 'center' });
            y += 5.4;
        }
        pdf.setFontSize(14);
        pdf.text(kParts.namaMadrasah, centerX, y, { align: 'center' });
        y += 4.5;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(8.8);
        if (kParts.alamatLine) {
            pdf.text(kParts.alamatLine, centerX, y, { align: 'center' });
            y += 3.8;
        }
        if (kParts.kontakLine) {
            pdf.text(kParts.kontakLine, centerX, y, { align: 'center' });
            y += 3.8;
        }
        y = Math.max(y, 33);
        pdf.setLineWidth(0.8);
        pdf.line(marginLeft, y, pageW - marginRight, y);
        pdf.setLineWidth(0.25);
        pdf.line(marginLeft, y + 0.9, pageW - marginRight, y + 0.9);
        y += 6.5;

        // Judul & Subjudul Dokumen
        pdf.setFont('times', 'bold');
        pdf.setFontSize(12.5);
        const docTitle =
            docType === 'berita_acara' ? 'BERITA ACARA PELAKSANAAN UJIAN' : 'DAFTAR HADIR PESERTA UJIAN';
        pdf.text(docTitle, centerX, y, { align: 'center' });
        const titleW = pdf.getTextWidth(docTitle);
        pdf.setLineWidth(0.35);
        pdf.line(centerX - titleW / 2, y + 0.8, centerX + titleW / 2, y + 0.8);
        y += 4.8;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(10);
        pdf.text(
            `Periode : ${currentSlot.period.name} — TA ${currentSlot.period.school_year || '-'} (${currentSlot.period.semester || '-'})`,
            centerX,
            y,
            { align: 'center' },
        );
        y += 6.5;

        // Meta Table (sama dengan format meta-table Laporan Guru Asuh)
        pdf.setFontSize(10);
        const metaLines: Array<[string, string]> = [
            ['Hari / Tanggal', dateLong],
            ['Ruang & Sesi Ujian', `${currentSlot.room.name} · ${currentSlot.session.name} (${sessionTime})`],
            ['Mata Pelajaran', subjectSummaryLabel],
            ['Kelas Peserta', classSummaryLabel],
            ['Status Dokumen', 'Disahkan'],
        ];
        for (const [label, val] of metaLines) {
            pdf.setFont('times', 'normal');
            pdf.setTextColor(0, 0, 0);
            pdf.text(label, marginLeft, y);
            pdf.text(':', marginLeft + 34, y);
            if (label === 'Status Dokumen') {
                pdf.setTextColor(37, 99, 235);
                pdf.text('Disahkan', marginLeft + 38, y);
                pdf.setTextColor(0, 0, 0);
            } else {
                pdf.text(val.substring(0, 82), marginLeft + 38, y);
            }
            y += 4.6;
        }
        y += 2;

        if (docType === 'berita_acara') {
            pdf.setFont('times', 'normal');
            pdf.setFontSize(10);
            const narrative = `Pada hari ini ${dateLong}, telah dilaksanakan ${currentSlot.period.name} secara Computer-Based Test (CBT) pada ${currentSlot.room.name} (${currentSlot.session.name}, pukul ${sessionTime}) dengan rincian kehadiran peserta dan catatan pelaksanaan sebagai berikut:`;
            const splitNarrative = pdf.splitTextToSize(narrative, contentW);
            pdf.text(splitNarrative, marginLeft, y);
            y += splitNarrative.length * 4.4 + 2.5;

            // Rekapitulasi Box
            pdf.setFont('times', 'bold');
            pdf.text('I. REKAPITULASI KEHADIRAN PESERTA', marginLeft, y);
            y += 2.5;
            const colW = contentW / 5;
            const headers = ['Peserta Terdaftar', 'Hadir', 'Sakit', 'Izin', 'Alpha'];
            const vals = [
                String(liveCounts.total),
                String(liveCounts.hadir),
                String(liveCounts.sakit),
                String(liveCounts.izin),
                String(liveCounts.alpha),
            ];
            for (let i = 0; i < 5; i++) {
                const x = marginLeft + i * colW;
                pdf.setFillColor(241, 245, 249);
                pdf.rect(x, y, colW, 6.2, 'FD');
                pdf.setFont('times', 'normal');
                pdf.setFontSize(9);
                pdf.text(headers[i], x + colW / 2, y + 4.2, { align: 'center' });
                pdf.rect(x, y + 6.2, colW, 7);
                pdf.setFont('times', 'bold');
                pdf.setFontSize(10.5);
                pdf.text(vals[i], x + colW / 2, y + 11, { align: 'center' });
            }
            y += 17.5;

            // Daftar Peserta Tidak Hadir
            pdf.setFont('times', 'bold');
            pdf.setFontSize(10);
            pdf.text('II. DAFTAR PESERTA TIDAK HADIR (SAKIT / IZIN / ALPHA)', marginLeft, y);
            y += 2.5;

            const absWidths = [10, 26, 62, 24, 53];
            const absHeaders = ['No', 'NIS', 'Nama Peserta', 'Kelas', 'Status & Keterangan'];
            let cx = marginLeft;
            pdf.setFillColor(241, 245, 249);
            pdf.setFont('times', 'normal');
            pdf.setFontSize(9);
            for (let i = 0; i < absHeaders.length; i++) {
                pdf.rect(cx, y, absWidths[i], 6.2, 'FD');
                pdf.text(absHeaders[i], cx + absWidths[i] / 2, y + 4.2, { align: 'center' });
                cx += absWidths[i];
            }
            y += 6.2;

            if (absentStudents.length === 0) {
                pdf.rect(marginLeft, y, contentW, 6.8);
                pdf.text(`Seluruh peserta hadir (${liveCounts.total} peserta).`, centerX, y + 4.5, {
                    align: 'center',
                });
                y += 10;
            } else {
                for (let idx = 0; idx < absentStudents.length; idx++) {
                    const st = absentStudents[idx];
                    cx = marginLeft;
                    const rowCells = [
                        String(idx + 1),
                        st.nis || '-',
                        st.full_name.substring(0, 34),
                        st.class_name || '-',
                        `${statusLabel(st.effectiveStatus)}${st.effectiveRemark ? ` — ${st.effectiveRemark}` : ''}`.substring(
                            0,
                            30,
                        ),
                    ];
                    for (let i = 0; i < rowCells.length; i++) {
                        pdf.rect(cx, y, absWidths[i], 6);
                        pdf.text(rowCells[i], cx + 2, y + 4.1);
                        cx += absWidths[i];
                    }
                    y += 6;
                }
                y += 3.5;
            }

            // Catatan & Insiden
            pdf.setFont('times', 'bold');
            pdf.setFontSize(10);
            pdf.text('III. CATATAN PELAKSANAAN & KEJADIAN KHUSUS', marginLeft, y);
            y += 2.5;
            pdf.rect(marginLeft, y, contentW, 18);
            pdf.setFont('times', 'normal');
            pdf.setFontSize(9.5);
            const noteText = `Catatan Pelaksanaan: ${notes || 'Pelaksanaan ujian berjalan tertib, aman, dan lancar.'}\nKejadian Khusus / Kendala Teknis: ${incidentSummary || 'Tidak ada kendala teknis.'}`;
            const splitNotes = pdf.splitTextToSize(noteText, contentW - 5);
            pdf.text(splitNotes.slice(0, 3), marginLeft + 2.5, y + 4.8);
            y += 23;
        } else {
            // Daftar Hadir Table
            const colWidths = [9, 24, 54, 21, 27, 18, 22];
            const headers = ['No', 'NIS', 'Nama Peserta', 'Kelas', 'Mulai-Selesai', 'Status', 'Ket.'];
            let cx = marginLeft;
            pdf.setFillColor(241, 245, 249);
            pdf.setFont('times', 'normal');
            pdf.setFontSize(8.8);
            for (let i = 0; i < headers.length; i++) {
                pdf.rect(cx, y, colWidths[i], 6.2, 'FD');
                pdf.text(headers[i], cx + colWidths[i] / 2, y + 4.2, { align: 'center' });
                cx += colWidths[i];
            }
            y += 6.2;

            pdf.setFont('times', 'normal');
            pdf.setFontSize(8.5);
            for (let idx = 0; idx < currentSlot.students.length; idx++) {
                if (y > 238) {
                    pdf.addPage();
                    y = 16;
                }
                const st = currentSlot.students[idx];
                const draft = attendanceMap[st.user_id];
                const stStatus = draft?.status || st.attendance_status || 'hadir';
                const stRemark = draft?.remark ?? st.remark ?? '';
                const timeRange = `${formatClockTime(st.started_at, timeZone)} - ${formatClockTime(st.finished_at, timeZone)}`;
                const cells = [
                    String(idx + 1),
                    (st.nis || '-').substring(0, 14),
                    st.full_name.substring(0, 29),
                    (st.class_name || '-').substring(0, 12),
                    timeRange,
                    statusLabel(stStatus),
                    (stRemark || '-').substring(0, 12),
                ];
                cx = marginLeft;
                for (let i = 0; i < cells.length; i++) {
                    pdf.rect(cx, y, colWidths[i], 5.8);
                    pdf.text(cells[i], cx + 1.5, y + 4);
                    cx += colWidths[i];
                }
                y += 5.8;
            }
            y += 4;
            pdf.setFont('times', 'normal');
            pdf.setFontSize(9.5);
            pdf.text(
                `Rekapitulasi: Terdaftar ${liveCounts.total} · Hadir ${liveCounts.hadir} · Sakit ${liveCounts.sakit} · Izin ${liveCounts.izin} · Alpha ${liveCounts.alpha}`,
                marginLeft,
                y,
            );
            y += 7;
        }

        const { topY: footerTopY } = drawAdministrationSigners(pdf, {
            y, marginLeft, pageWidth: pageW, marginRight, signedAt: signedAtText,
            invigilator: { name: effectiveInvName, nip: effectiveInvNip },
            proctor: { name: effectiveProcName, nip: effectiveProcNip },
            committeeChair: { name: effectiveChairName, nip: effectiveChairNip },
        });

        // Right-side QR Verification Block (.verify-wrap)
        const qrBoxSize = 18;
        const qrCenterX = pageW - marginRight - 22;
        if (qrPngUrl) {
            pdf.addImage(qrPngUrl, 'PNG', qrCenterX - qrBoxSize / 2, footerTopY - 3, qrBoxSize, qrBoxSize);
        }
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(85, 85, 85);
        pdf.text('Pindai untuk verifikasi keaslian dokumen', qrCenterX, footerTopY + qrBoxSize - 0.5, {
            align: 'center',
        });
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(6.5);
        pdf.setTextColor(119, 119, 119);
        pdf.text(code, qrCenterX, footerTopY + qrBoxSize + 2.5, { align: 'center' });

        const safeRoom = currentSlot.room.name.replace(/[^a-zA-Z0-9_-]/g, '-');
        const safeSession = currentSlot.session.name.replace(/[^a-zA-Z0-9_-]/g, '-');
        const assessmentCode = currentSlot.period.type === 'am' ? 'AM' : 'ASAS-ASAT';
        const prefix = docType === 'berita_acara' ? `Berita-Acara-${assessmentCode}` : `Daftar-Hadir-${assessmentCode}`;
        pdf.save(`${prefix}-${safeRoom}-${safeSession}-${currentSlot.exam_date}.pdf`);
    };

    if (rooms.length === 0 || sessions.length === 0) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
                <AlertCircle size={36} className="mx-auto text-amber-500" />
                <h3 className="text-sm font-bold text-slate-800">Ruang atau Sesi Ujian Belum Tersedia</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Tambahkan ruang dan sesi ujian terlebih dahulu.
                </p>
            </div>
        );
    }

    const handleDownloadSchedule = async () => {
        setIsPrintingSchedule(true);
        try {
            const { downloadAdministrationSchedulePdf } = await import('@/lib/pas/administration-schedule-pdf');
            await downloadAdministrationSchedulePdf({
                ...period,
                profil_sekolah: period.profil_sekolah || slot?.profil_sekolah || {
                    nama: slot?.period.organization_name || 'MADRASAH',
                },
            }, rooms, sessions);
        } catch (error) {
            await alertDialog({ title: 'Jadwal Belum Dapat Dicetak',
                text: error instanceof Error ? error.message : 'Gagal membuat PDF jadwal.', variant: 'danger' });
        } finally {
            setIsPrintingSchedule(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="pas-administration-view" className="text-xs font-medium text-slate-500">Tampilan</label>
                    <InlineSelect
                        id="pas-administration-view"
                        value={subView}
                        onChange={value => setSubView(value as AdminSubView)}
                        title="Pilih tampilan administrasi"
                        minWidth="220px"
                        height="36px"
                        options={[
                            ...(resolvedRole !== 'pengawas' ? [{ value: 'overview', label: 'Persetujuan dokumen' }] : []),
                            { value: 'editor', label: 'Absensi & berita acara' },
                            { value: 'berita_acara_a4', label: 'Berita acara (A4)' },
                            { value: 'daftar_hadir_a4', label: 'Daftar hadir (A4)' },
                        ]}
                    />
                    {resolvedRole !== 'pengawas' && <Button variant="outline" size="sm"
                        disabled={isPrintingSchedule || !period.pas_class_schedules?.length}
                        isLoading={isPrintingSchedule} onClick={() => void handleDownloadSchedule()}
                        leftIcon={<Printer size={14} />}>
                        Unduh Jadwal PDF
                    </Button>}
                    {resolvedRole !== 'pengawas' && pendingApprovalCount > 0 && (
                        <span className="text-xs text-amber-700">{pendingApprovalCount} menunggu persetujuan</span>
                    )}
                </div>

                {/* Right side: Committee Chair quick config */}
                {subView !== 'overview' && <div className="flex items-center gap-2 self-start">
                    <div className="inline-flex flex-wrap items-center gap-2 text-xs">
                        <UserCheck size={13} className="text-[#3083FF] shrink-0" />
                        <span className="text-slate-500">Ketua Panitia:</span>
                        <strong className="text-slate-800 max-w-[180px] truncate">
                            {slot?.committee_chair?.committee_chair_name || period.committee_chair_name || 'Belum diatur'}
                        </strong>
                        {!period.is_locked && (
                            <button
                                type="button"
                                onClick={openChairModal}
                                className="text-[11px] font-bold text-[#3083FF] hover:underline cursor-pointer ml-1"
                            >
                                (Atur)
                            </button>
                        )}
                    </div>
                </div>}
            </div>

            {subView === 'overview' ? (
                <div className="space-y-4">
                    <dl className="flex flex-wrap gap-x-6 gap-y-2 py-2">
                        {[
                            ['Ruang & sesi', overviewItems.length],
                            ['Menunggu persetujuan', pendingApprovalCount],
                            ['Disahkan', overviewItems.filter(i => i.status === 'approved').length],
                            ['Draft', overviewItems.filter(i => i.status !== 'approved' && i.status !== 'submitted').length],
                        ].map(([label, count]) => (
                            <div key={label} className="flex items-baseline gap-2 text-xs">
                                <dt className="text-slate-500">{label}</dt>
                                <dd className="font-semibold tabular-nums text-slate-800">{count}</dd>
                            </div>
                        ))}
                    </dl>

                    {/* Table of all slots */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <FileCheck2 size={16} className="text-[#3083FF]" />
                                    Dokumen ruang ujian
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => void loadOverview()}
                                disabled={isLoadingOverview}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer self-start sm:self-auto"
                            >
                                <RefreshCw size={13} className={isLoadingOverview ? 'animate-spin text-[#3083FF]' : ''} />
                                Segarkan Data
                            </button>
                        </div>

                        {overviewError && <p role="alert" className="px-5 py-3 text-xs text-red-700">{overviewError}</p>}
                        {isLoadingOverview ? (
                            <div className="p-12 flex flex-col items-center justify-center gap-2 text-slate-500">
                                <Loader2 size={24} className="animate-spin text-[#3083FF]" />
                                <span className="text-xs">Memuat rekapitulasi administrasi...</span>
                            </div>
                        ) : overviewItems.length === 0 ? (
                            <div className="p-12 text-center text-slate-400 text-xs">
                                Belum ada ruang atau sesi ujian yang dijadwalkan pada folder ini.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-xs font-medium text-slate-500">
                                            <th className="py-3 px-4">Ruang &amp; Sesi</th>
                                            <th className="py-3 px-3">Tanggal</th>
                                            <th className="py-3 px-3">Pengawas</th>
                                            <th className="py-3 px-3 text-center">Kehadiran</th>
                                            <th className="py-3 px-3">Status</th>
                                            <th className="py-3 px-4 text-right">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {overviewItems.map((item) => {
                                            const isSubmitted = item.status === 'submitted';
                                            const isApproved = item.status === 'approved' && (item.signature_version || 1) >= 3;
                                            const isRejected = item.status === 'rejected';

                                            return (
                                                <tr
                                                    key={`${item.room_id}-${item.session_id}-${item.exam_date}`}
                                                    className={`hover:bg-slate-50/80 transition-colors ${
                                                        isSubmitted ? 'bg-amber-50/40' : ''
                                                    }`}
                                                >
                                                    <td className="py-3 px-4">
                                                        <div className="font-bold text-slate-800">{item.room_name}</div>
                                                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                                            <Clock size={11} className="text-slate-400" />
                                                            <span>{item.session_name} ({item.start_time.substring(0, 5)} - {item.end_time.substring(0, 5)})</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">
                                                        {formatIndonesianLongDate(item.exam_date)}
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="text-slate-800 font-medium">
                                                            {item.assigned_invigilators.length > 0
                                                                ? item.assigned_invigilators.join(', ')
                                                                : item.invigilator_name || '-'}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                                        <span className="font-bold text-slate-800">
                                                            {item.counts.hadir} / {item.counts.total} Hadir
                                                        </span>
                                                        {(item.counts.sakit > 0 || item.counts.izin > 0 || item.counts.alpha > 0) && (
                                                            <div className="flex items-center justify-center gap-1 mt-1 text-[10px]">
                                                                {item.counts.sakit > 0 && (
                                                                    <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-700 font-bold">
                                                                        S: {item.counts.sakit}
                                                                    </span>
                                                                )}
                                                                {item.counts.izin > 0 && (
                                                                    <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-bold">
                                                                        I: {item.counts.izin}
                                                                    </span>
                                                                )}
                                                                {item.counts.alpha > 0 && (
                                                                    <span className="px-1.5 py-0.2 rounded bg-red-100 text-red-700 font-bold">
                                                                        A: {item.counts.alpha}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-3 whitespace-nowrap">
                                                        {isApproved ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                <CheckCircle2 size={12} />
                                                                Resmi (Disahkan)
                                                            </span>
                                                        ) : isSubmitted ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-300 shadow-2xs animate-pulse">
                                                                <Clock size={12} />
                                                                Menunggu ACC
                                                            </span>
                                                        ) : isRejected ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-50 text-red-700 border border-red-200" title={item.rejection_note || 'Perlu perbaikan'}>
                                                                <AlertCircle size={12} />
                                                                Perlu Perbaikan
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                                <Edit size={12} />
                                                                Draft
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                                        <div className="inline-flex items-center gap-1.5">
                                                            {isSubmitted && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleApproveSlot({ roomId: item.room_id, sessionId: item.session_id, examDate: item.exam_date })}
                                                                    disabled={isApproving}
                                                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                                                                    title="ACC menjadi dokumen resmi"
                                                                >
                                                                    <CheckCircle2 size={13} />
                                                                    ACC Dokumen
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedRoomId(item.room_id);
                                                                    setSelectedSessionId(item.session_id);
                                                                    setSelectedDate(item.exam_date);
                                                                    setSubView('editor');
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 text-slate-700 hover:text-[#3083FF] font-semibold text-xs transition-colors cursor-pointer"
                                                            >
                                                                {isSubmitted ? 'Periksa' : 'Buka'}
                                                            </button>
                                                            {isSubmitted && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenRejectModal({ roomId: item.room_id, sessionId: item.session_id, examDate: item.exam_date, roomName: item.room_name })}
                                                                    className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs transition-colors cursor-pointer"
                                                                    title="Minta Perbaikan / Kembalikan ke Pengawas"
                                                                >
                                                                    <X size={13} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* ── Filter Bar: Ruang + Sesi + Tanggal ── */}
                    <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Ruang Ujian
                                </label>
                                <InlineSelect
                                    value={selectedRoomId}
                                    onChange={(val) => setSelectedRoomId(val)}
                                    options={rooms.map((r) => ({
                                        value: r.id,
                                        label: r.name,
                                    }))}
                                    minWidth="100%"
                                    height="38px"
                                    title="Pilih Ruang Ujian"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Sesi Ujian
                                </label>
                                <InlineSelect
                                    value={selectedSessionId}
                                    onChange={(val) => setSelectedSessionId(val)}
                                    options={sessions.map((s) => ({
                                        value: s.id,
                                        label: `${s.name} (${s.start_time.substring(0, 5)} - ${s.end_time.substring(0, 5)})`,
                                    }))}
                                    minWidth="100%"
                                    height="38px"
                                    title="Pilih Sesi Ujian"
                                />
                                </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Tanggal Pelaksanaan
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        min={period.start_date?.split('T')[0] || undefined}
                                        max={period.end_date?.split('T')[0] || undefined}
                                        onChange={(e) => setSelectedDate(e.target.value)}
                                        className="w-full h-[38px] px-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void loadSlot()}
                                        disabled={isLoading}
                                        title="Muat ulang data absensi & waktu ujian"
                                        className="h-[38px] w-[38px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                        <RefreshCw size={14} className={isLoading ? 'animate-spin text-[#3083FF]' : ''} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {loadError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center justify-between">
                            <span>{loadError}</span>
                            <button type="button" onClick={() => void loadSlot()} className="font-bold underline ml-3 cursor-pointer">
                                Muat Ulang
                            </button>
                        </div>
                    )}

                    {saveNotice && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 font-medium">
                                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                                {saveNotice}
                            </span>
                            {baVerificationCode && (
                                <a
                                    href={`/verify/${encodeURIComponent(baVerificationCode)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline shrink-0"
                                >
                                    Cek Halaman Verifikasi <ExternalLink size={12} />
                                </a>
                            )}
                        </div>
                    )}

                    {isLoading || !slot ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-16 flex flex-col items-center justify-center gap-2">
                            <Loader2 size={28} className="animate-spin text-[#3083FF]" />
                            <p className="text-xs text-slate-500 font-medium">Memuat data peserta, waktu ujian, dan Berita Acara...</p>
                        </div>
                    ) : subView === 'editor' ? (
                        <div className="space-y-4">
                            {/* ── Status Alert Banner ── */}
                            <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                slot.report.status === 'approved'
                                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                    : slot.report.status === 'submitted'
                                      ? 'bg-amber-50/80 border-amber-300 text-amber-900 shadow-2xs'
                                      : slot.report.status === 'rejected'
                                        ? 'bg-red-50/70 border-red-200 text-red-900'
                                        : 'bg-slate-50 border-slate-200 text-slate-800'
                            }`}>
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                                        slot.report.status === 'approved'
                                            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                            : slot.report.status === 'submitted'
                                              ? 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse'
                                              : slot.report.status === 'rejected'
                                                ? 'bg-red-100 text-red-700 border-red-300'
                                                : 'bg-slate-200/70 text-slate-600 border-slate-300'
                                    }`}>
                                        {slot.report.status === 'approved' ? (
                                            <ShieldCheck size={18} />
                                        ) : slot.report.status === 'submitted' ? (
                                            <Clock size={18} />
                                        ) : slot.report.status === 'rejected' ? (
                                            <AlertCircle size={18} />
                                        ) : (
                                            <Edit size={18} />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                                                slot.report.status === 'approved'
                                                    ? 'bg-emerald-600 text-white'
                                                    : slot.report.status === 'submitted'
                                                      ? 'bg-amber-500 text-white'
                                                      : slot.report.status === 'rejected'
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-slate-500 text-white'
                                            }`}>
                                                {slot.report.status === 'approved'
                                                    ? 'Resmi & Disahkan'
                                                    : slot.report.status === 'submitted'
                                                      ? 'Menunggu ACC Proktor'
                                                      : slot.report.status === 'rejected'
                                                        ? 'Perlu Perbaikan'
                                                        : 'Draft'}
                                            </span>
                                            {slot.report.submitted_at && slot.report.status === 'submitted' && (
                                                <span className="text-xs text-amber-800 font-medium">
                                                    Diserahkan pada {formatSignedTimestamp(slot.report.submitted_at, timeZone)}
                                                </span>
                                            )}
                                            {slot.report.approved_at && slot.report.status === 'approved' && (
                                                <span className="text-xs text-emerald-800 font-medium">
                                                    Disahkan oleh {slot.report.proctor_name || 'Proktor'} pada {formatSignedTimestamp(slot.report.approved_at, timeZone)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs mt-1 text-slate-600">
                                            {slot.report.status === 'approved'
                                                ? 'Dokumen resmi siap diunduh dan diverifikasi.'
                                                : slot.report.status === 'submitted'
                                                  ? 'Menunggu pemeriksaan proktor.'
                                                  : slot.report.status === 'rejected'
                                                    ? `Catatan perbaikan dari Proktor: "${slot.report.rejection_note || 'Perlu perbaikan.'}"`
                                                    : 'Isi absensi dan berita acara, lalu kirim ke proktor.'}
                                        </p>
                                        {slot.report.is_saved && slot.report.signature_version < 3 && (
                                            <p className="mt-1 text-xs font-medium text-amber-700">
                                                Dokumen lama perlu diperiksa dan di-ACC ulang.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {resolvedRole !== 'pengawas' && (slot.report.status !== 'approved' || slot.report.signature_version < 3) && (
                                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                        {slot.report.status === 'submitted' && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleOpenRejectModal()}
                                                disabled={isLoading || isApproving}
                                                className="text-red-700 border-red-300 hover:bg-red-50"
                                                leftIcon={<AlertCircle size={13} />}
                                            >
                                                Minta Perbaikan
                                            </Button>
                                        )}
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => void handleApproveSlot()}
                                            disabled={isLoading || isApproving}
                                            isLoading={isApproving}
                                            className="bg-[#3083FF] hover:bg-blue-600 text-white"
                                            leftIcon={<CheckCircle2 size={13} />}
                                        >
                                            ACC Dokumen Resmi
                                        </Button>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                    {/* ── Left Column (7 cols): Daftar Hadir & Absensi Peserta ── */}
                    <div className={`xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col ${slot.students.length === 0 ? 'self-start' : ''}`}>
                        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <Users size={15} className="text-[#3083FF]" />
                                    Daftar Hadir & Absensi
                                </h3>
                                {slot.students.length > 0 && (
                                    <p className="mt-1 text-xs text-slate-500">{liveCounts.total} peserta · {liveCounts.hadir} hadir
                                        {(liveCounts.sakit + liveCounts.izin + liveCounts.alpha) > 0 &&
                                            ` · ${liveCounts.sakit + liveCounts.izin + liveCounts.alpha} tidak hadir`}
                                    </p>
                                )}
                            </div>
                            {slot.students.length > 0 && <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                <button
                                    type="button"
                                    onClick={syncFromExamActivity}
                                    title="Set Hadir untuk peserta yang tercatat mulai ujian"
                                    className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-[#3083FF] text-xs font-semibold transition-colors"
                                >
                                    Sinkron Aktivitas
                                </button>
                                <button
                                    type="button"
                                    onClick={markAllHadir}
                                    className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-emerald-700 text-xs font-semibold transition-colors"
                                >
                                    Tandai Semua Hadir
                                </button>
                            </div>}
                        </div>

                        {slot.students.length > 0 && (liveCounts.sakit > 0 || liveCounts.izin > 0 || liveCounts.alpha > 0 || slot.students.length > 8 || studentSearch.trim().length > 0) && (
                        <div className="px-4 py-2 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3 flex-wrap text-xs text-slate-600">
                                {liveCounts.sakit > 0 && <span>Sakit <strong className="text-amber-700">{liveCounts.sakit}</strong></span>}
                                {liveCounts.izin > 0 && <span>Izin <strong className="text-blue-700">{liveCounts.izin}</strong></span>}
                                {liveCounts.alpha > 0 && <span>Alpha <strong className="text-red-700">{liveCounts.alpha}</strong></span>}
                            </div>
                            {(slot.students.length > 8 || studentSearch.trim().length > 0) && <div className="relative w-full sm:w-56 sm:ml-auto">
                                <Search
                                    size={13}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                                />
                                <input
                                    type="text"
                                    value={studentSearch}
                                    onChange={(e) => setStudentSearch(e.target.value)}
                                    placeholder="Cari nama, NIS, kelas..."
                                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#3083FF]"
                                />
                            </div>}
                        </div>
                        )}

                        {/* Table */}
                        {slot.students.length === 0 ? (
                            <p className="px-5 py-8 text-center text-xs text-slate-500">
                                Belum ada peserta yang ditempatkan di ruang ini.
                            </p>
                        ) : <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100 text-xs font-medium text-slate-500">
                                        <th className="py-2.5 px-3 w-10 text-center">No</th>
                                        <th className="py-2.5 px-3">Peserta & Kelas</th>
                                        <th className="py-2.5 px-3">Waktu Mulai – Selesai</th>
                                        <th className="py-2.5 px-3">Status Kehadiran</th>
                                        <th className="py-2.5 px-3">Keterangan</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-xs">
                                    {filteredStudents.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="py-10 text-center text-slate-400">
                                                Tidak ada peserta yang cocok dengan pencarian.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredStudents.map((st, index) => {
                                            const currentStatus =
                                                attendanceMap[st.user_id]?.status || st.attendance_status || 'hadir';
                                            const currentRemark =
                                                attendanceMap[st.user_id]?.remark ?? st.remark ?? '';
                                            const startTime = formatClockTime(st.started_at, timeZone);
                                            const endTime = formatClockTime(st.finished_at, timeZone);
                                            const hasActivityMismatch =
                                                Boolean(st.started_at) && currentStatus !== 'hadir';

                                            return (
                                                <tr key={st.user_id} className="hover:bg-slate-50/70">
                                                    <td className="py-2.5 px-3 text-center font-semibold text-slate-400">
                                                        {index + 1}
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <div className="font-bold text-slate-800">{st.full_name}</div>
                                                        <div className="text-[11px] text-slate-500">
                                                            NIS: {st.nis} · <span className="font-medium text-slate-700">{st.class_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <div className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            <Clock size={11} className="text-slate-500" />
                                                            {startTime} – {endTime}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                            {st.attempt_status === 'finished' || st.attempt_status === 'selesai'
                                                                ? 'Selesai mengerjakan'
                                                                : st.attempt_status === 'in_progress' || st.attempt_status === 'sedang'
                                                                  ? 'Sedang mengerjakan'
                                                                  : 'Belum mulai ujian'}
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 gap-0.5">
                                                            {(
                                                                [
                                                                    { id: 'hadir', label: 'Hadir', activeCls: 'bg-emerald-600 text-white' },
                                                                    { id: 'sakit', label: 'Sakit', activeCls: 'bg-amber-500 text-white' },
                                                                    { id: 'izin', label: 'Izin', activeCls: 'bg-blue-600 text-white' },
                                                                    { id: 'alpha', label: 'Alpha', activeCls: 'bg-red-600 text-white' },
                                                                ] as const
                                                            ).map((opt) => (
                                                                <button
                                                                    key={opt.id}
                                                                    type="button"
                                                                    onClick={() => updateStudentStatus(st.user_id, opt.id)}
                                                                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                                                                        currentStatus === opt.id
                                                                            ? opt.activeCls
                                                                            : 'text-slate-600 hover:bg-slate-200/70'
                                                                    }`}
                                                                >
                                                                    {opt.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {hasActivityMismatch && (
                                                            <div className="text-[10px] text-amber-600 font-semibold mt-1">
                                                                ⚠ Tercatat mulai ujian ({startTime})
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <input
                                                            type="text"
                                                            value={currentRemark}
                                                            onChange={(e) => updateStudentRemark(st.user_id, e.target.value)}
                                                            placeholder={
                                                                currentStatus === 'sakit'
                                                                    ? 'Ket. sakit...'
                                                                    : currentStatus === 'izin'
                                                                      ? 'Ket. izin...'
                                                                      : 'Catatan...'
                                                            }
                                                            className="w-full min-w-[110px] px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#3083FF]"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>}
                    </div>

                    {/* ── Right Column (5 cols): Form Berita Acara & Tanda Tangan ── */}
                    <div className="xl:col-span-5 space-y-4">
                        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-4">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <FileText size={15} className="text-[#3083FF]" />
                                    Berita Acara Pelaksanaan Ujian
                                </h3>
                                {slot.schedules.length > 0 && (
                                    <p className="mt-1 text-xs text-slate-500">Mata pelajaran · {subjectSummaryLabel}</p>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Catatan Pelaksanaan Ujian
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Catatan pelaksanaan ujian (opsional)..."
                                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 resize-y"
                                    />
                                </div>

                                <div>
                                    <button
                                        type="button"
                                        aria-expanded={showIncidentDetails}
                                        aria-controls="pas-incident-summary"
                                        onClick={() => setShowIncidentDetails((open) => !open)}
                                        className="text-xs font-semibold text-[#3083FF] hover:underline"
                                    >
                                        {showIncidentDetails ? 'Sembunyikan kejadian khusus' : hasNotableIncident(incidentSummary) ? 'Lihat kejadian khusus' : '+ Tambah kejadian khusus / kendala'}
                                    </button>
                                    {showIncidentDetails && (
                                        <div id="pas-incident-summary" className="mt-2">
                                            <label htmlFor="pas-incident-text" className="block text-xs font-bold text-slate-700 mb-1">
                                                Kejadian Khusus / Kendala Teknis
                                            </label>
                                            <textarea
                                                id="pas-incident-text"
                                                rows={2}
                                                value={incidentSummary}
                                                onChange={(e) => setIncidentSummary(e.target.value)}
                                                placeholder="Catat jika ada kejadian atau kendala..."
                                                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 resize-y"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Pengawas Ruang
                                        </label>
                                        <p className="min-h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                                            {slot.invigilators.length ? invigilatorName : 'Belum ada pengawas yang ditugaskan pada tanggal ini.'}
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Proktor (Pembuat Ujian)
                                        </label>
                                        <p className="py-2 text-xs font-medium text-slate-700">{proctorName || 'Belum ditetapkan'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Digital Verification Card */}
                            {slot.report.status === 'approved' && slot.report.signature_version >= 3 && (
                            <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-3.5 flex items-start gap-3">
                                {baQrSvgUrl ? (
                                    <Image unoptimized width={96} height={96}
                                        src={baQrSvgUrl}
                                        alt="QR Verifikasi Berita Acara"
                                        className="w-16 h-16 rounded-lg border border-slate-200 bg-white p-1 shrink-0"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-lg border border-slate-200 bg-white flex items-center justify-center shrink-0">
                                        <QrCode size={28} className="text-slate-400" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1 text-xs space-y-1">
                                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                        <ShieldCheck size={14} className="text-[#3083FF] shrink-0" />
                                        Verifikasi Keaslian Dokumen (QR & SHA-256)
                                    </div>
                                    <div className="text-[11px] text-slate-600">
                                        Berita Acara: <code className="font-bold text-slate-800">{baVerificationCode}</code>
                                    </div>
                                    <div className="text-[11px] text-slate-600">
                                        Daftar Hadir: <code className="font-bold text-slate-800">{dhVerificationCode}</code>
                                    </div>
                                    <div className="text-[10px] font-mono text-slate-500 truncate">
                                        Hash: {slot.report.signature_hash}
                                    </div>
                                    <div className="pt-1 flex items-center gap-3">
                                        <a
                                            href={`/verify/${encodeURIComponent(baVerificationCode)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#3083FF] hover:underline"
                                        >
                                            Verifikasi Berita Acara <ExternalLink size={11} />
                                        </a>
                                        <a
                                            href={`/verify/${encodeURIComponent(dhVerificationCode)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#3083FF] hover:underline"
                                        >
                                            Verifikasi Daftar Hadir <ExternalLink size={11} />
                                        </a>
                                    </div>
                                </div>
                            </div>
                            )}

                            {(resolvedRole === 'pengawas' || (slot.report.status === 'approved' && slot.report.signature_version >= 3)) && (
                            <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100">
                                {slot.report.status === 'approved' && slot.report.signature_version >= 3 && <div className="flex items-center gap-2 flex-wrap">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleDownloadPdfA4('berita_acara')}
                                        leftIcon={<Download size={13} />}
                                    >
                                        Unduh Berita Acara (PDF)
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleDownloadPdfA4('daftar_hadir')}
                                        leftIcon={<Download size={13} />}
                                    >
                                        Unduh Daftar Hadir (PDF)
                                    </Button>
                                </div>}
                                {resolvedRole === 'pengawas' && (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleSaveSlot('save_draft', false)}
                                            disabled={isSaving}
                                            isLoading={isSaving}
                                            leftIcon={<Save size={13} />}
                                        >
                                            Simpan Draft
                                        </Button>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => void handleSaveSlot('submit', false)}
                                            disabled={isSaving}
                                            isLoading={isSaving}
                                            className="bg-amber-600 hover:bg-amber-700 text-white"
                                            leftIcon={<CheckCircle2 size={13} />}
                                        >
                                            Kirim ke Proktor (Submit)
                                        </Button>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            ) : (
                /* ── A4 Document Preview (Berita Acara or Daftar Hadir) — Identik KOP & Proporsi Laporan Guru Asuh acca-new ── */
                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-slate-600 font-medium">
                            Pratinjau Dokumen Ukuran <strong>A4 Portrait (794px · Margin 10mm 15mm 15mm 20mm)</strong> —{' '}
                            {subView === 'berita_acara_a4'
                                ? `Berita Acara (${baVerificationCode})`
                                : `Daftar Hadir Peserta (${dhVerificationCode})`}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    void handlePrintA4(
                                        subView === 'berita_acara_a4' ? 'berita_acara' : 'daftar_hadir',
                                    )
                                }
                                leftIcon={<Printer size={13} />}
                            >
                                Cetak A4
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() =>
                                    void handleDownloadPdfA4(
                                        subView === 'berita_acara_a4' ? 'berita_acara' : 'daftar_hadir',
                                    )
                                }
                                leftIcon={<Download size={13} />}
                            >
                                Unduh PDF A4
                            </Button>
                        </div>
                    </div>

                    <div className="bg-slate-200/70 rounded-2xl p-4 sm:p-8 overflow-x-auto flex justify-center">
                        <div
                            className="bg-white shadow-xl border border-slate-300 text-black w-[794px] min-h-[1123px] p-[10mm_15mm_15mm_20mm] shrink-0"
                            style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '10.5pt', lineHeight: 1.38 }}
                        >
                            {/* KOP SURAT RESMI (Sama persis dengan KOP Laporan Guru Asuh pada acca-new) */}
                            <div className="relative block min-h-[80px]">
                                {kopParts.logoUrl ? (
                                    <Image unoptimized width={96} height={96}
                                        src={kopParts.logoUrl}
                                        alt="Logo Madrasah"
                                        className="absolute left-0 top-0 w-[80px] h-[80px] object-contain"
                                    />
                                ) : (
                                    <div className="absolute left-0 top-0 w-[80px] h-[80px]" />
                                )}
                                <div className="w-full text-center">
                                    {kopParts.isMadrasah && (
                                        <>
                                            <div className="font-bold uppercase leading-[1.25]" style={{ fontSize: '12pt' }}>
                                                {kopParts.kemenagLine1}
                                            </div>
                                            <div className="font-bold uppercase leading-[1.25]" style={{ fontSize: '12pt' }}>
                                                {kopParts.kemenagLine2}
                                            </div>
                                        </>
                                    )}
                                    <div className="font-bold uppercase leading-[1.25]" style={{ fontSize: '15pt' }}>
                                        {kopParts.namaMadrasah}
                                    </div>
                                    {kopParts.alamatLine && (
                                        <div className="text-[#222] leading-[1.25]" style={{ fontSize: '9pt' }}>
                                            {kopParts.alamatLine}
                                        </div>
                                    )}
                                    {kopParts.kontakLine && (
                                        <div className="text-[#222] leading-[1.25]" style={{ fontSize: '9pt' }}>
                                            {kopParts.kontakLine}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="border-t-[3px] border-black mt-[6px]" />
                            <div className="border-t border-black mt-[2px] mb-[16px]" />

                            {/* Judul & Subjudul Dokumen */}
                            <div className="text-center mt-[14px] mb-[4px]">
                                <h1
                                    className="font-bold underline uppercase"
                                    style={{
                                        fontSize: '12.5pt',
                                        textUnderlineOffset: '4px',
                                        letterSpacing: '1px',
                                    }}
                                >
                                    {subView === 'berita_acara_a4'
                                        ? 'BERITA ACARA PELAKSANAAN UJIAN'
                                        : 'DAFTAR HADIR PESERTA UJIAN'}
                                </h1>
                            </div>
                            <div className="text-center mb-[14px]" style={{ fontSize: '10pt' }}>
                                Periode :{' '}
                                <strong>
                                    {slot.period.name} — TA {slot.period.school_year || '-'} (
                                    {slot.period.semester || '-'})
                                </strong>
                            </div>

                            {subView === 'berita_acara_a4' ? (
                                <div>
                                    {/* Meta Table (identik dengan .meta-table Laporan Guru Asuh) */}
                                    <table className="w-full mb-[12px] border-collapse" style={{ fontSize: '10pt' }}>
                                        <tbody>
                                            <tr>
                                                <td className="py-[1.5px] w-[125px]">Hari / Tanggal</td>
                                                <td className="py-[1.5px] w-[14px]">:</td>
                                                <td className="py-[1.5px]">{formatIndonesianLongDate(slot.exam_date)}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Ruang &amp; Sesi Ujian</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    {slot.room.name} · {slot.session.name} (
                                                    {slot.session.start_time.substring(0, 5)} -{' '}
                                                    {slot.session.end_time.substring(0, 5)})
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Mata Pelajaran</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">{subjectSummaryLabel}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Kelas Peserta</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">{classSummaryLabel}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Pengawas Ruang</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    {invigilatorName || slot.report.invigilator_name || '-'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Status Dokumen</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    {slot.report.status === 'approved' ? (
                                                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                                            <CheckCircle2 size={13} className="text-emerald-700" />
                                                            Resmi &amp; Disahkan
                                                        </span>
                                                    ) : slot.report.status === 'submitted' ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                                                            <Clock size={13} className="text-amber-700" />
                                                            Menunggu ACC Proktor (Draft Berita Acara)
                                                        </span>
                                                    ) : slot.report.status === 'rejected' ? (
                                                        <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                                                            <AlertCircle size={13} className="text-red-700" />
                                                            Perlu Perbaikan
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-slate-600 font-bold">
                                                            <Edit size={13} className="text-slate-600" />
                                                            Draft Belum Dikirim
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <p className="text-justify mb-[10px]" style={{ fontSize: '10pt', lineHeight: 1.45 }}>
                                        Pada hari ini <strong>{formatIndonesianLongDate(slot.exam_date)}</strong>, telah
                                        dilaksanakan <strong>{slot.period.name}</strong> secara Computer-Based Test (CBT)
                                        pada <strong>{slot.room.name}</strong> ({slot.session.name}, pukul{' '}
                                        {slot.session.start_time.substring(0, 5)} -{' '}
                                        {slot.session.end_time.substring(0, 5)}) dengan rincian kehadiran peserta dan
                                        catatan pelaksanaan sebagai berikut:
                                    </p>

                                    <div className="font-bold uppercase mt-[10px] mb-[5px]" style={{ fontSize: '10pt' }}>
                                        I. Rekapitulasi Kehadiran Peserta
                                    </div>
                                    <table
                                        className="w-full border border-[#333] border-collapse text-center mb-[14px]"
                                        style={{ fontSize: '9pt' }}
                                    >
                                        <thead>
                                            <tr className="bg-[#f1f5f9]">
                                                <th className="border border-[#333] py-[5px] px-[6px] font-normal">
                                                    Peserta Terdaftar
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] font-normal">
                                                    Hadir
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] font-normal">
                                                    Sakit
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] font-normal">
                                                    Izin
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] font-normal">
                                                    Tanpa Keterangan (Alpha)
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="font-bold" style={{ fontSize: '10.5pt' }}>
                                                <td className="border border-[#333] py-[5px] px-[6px]">
                                                    {liveCounts.total}
                                                </td>
                                                <td className="border border-[#333] py-[5px] px-[6px]">
                                                    {liveCounts.hadir}
                                                </td>
                                                <td className="border border-[#333] py-[5px] px-[6px]">
                                                    {liveCounts.sakit}
                                                </td>
                                                <td className="border border-[#333] py-[5px] px-[6px]">
                                                    {liveCounts.izin}
                                                </td>
                                                <td className="border border-[#333] py-[5px] px-[6px]">
                                                    {liveCounts.alpha}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <div className="font-bold uppercase mt-[10px] mb-[5px]" style={{ fontSize: '10pt' }}>
                                        II. Daftar Peserta Tidak Hadir (Sakit / Izin / Alpha)
                                    </div>
                                    <table
                                        className="w-full border border-[#333] border-collapse mb-[14px]"
                                        style={{ fontSize: '9pt' }}
                                    >
                                        <thead>
                                            <tr className="bg-[#f1f5f9]">
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[6%] text-center font-normal">
                                                    No
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[16%] text-center font-normal">
                                                    NIS
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[34%] text-center font-normal">
                                                    Nama Peserta
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[14%] text-center font-normal">
                                                    Kelas
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] text-center font-normal">
                                                    Status &amp; Keterangan
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {absentStudents.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={5}
                                                        className="border border-[#333] py-[8px] px-[6px] text-center text-[#555]"
                                                    >
                                                        Seluruh peserta hadir ({liveCounts.total} peserta).
                                                    </td>
                                                </tr>
                                            ) : (
                                                absentStudents.map((st, idx) => (
                                                    <tr key={st.user_id}>
                                                        <td className="border border-[#333] py-[5px] px-[6px] text-center">
                                                            {idx + 1}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px]">
                                                            {st.nis}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px]">
                                                            {st.full_name}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px] text-center">
                                                            {st.class_name}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px]">
                                                            <strong>{statusLabel(st.effectiveStatus)}</strong>
                                                            {st.effectiveRemark ? ` — ${st.effectiveRemark}` : ''}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>

                                    <div className="font-bold uppercase mt-[10px] mb-[5px]" style={{ fontSize: '10pt' }}>
                                        III. Catatan Pelaksanaan &amp; Kejadian Khusus
                                    </div>
                                    <div
                                        className="border border-[#333] p-[7px_9px] mb-[14px] space-y-1"
                                        style={{ fontSize: '9.5pt', lineHeight: 1.4 }}
                                    >
                                        <div>
                                            <strong>Catatan Pelaksanaan:</strong>{' '}
                                            {notes || 'Pelaksanaan ujian berjalan tertib, aman, dan lancar.'}
                                        </div>
                                        <div>
                                            <strong>Kejadian Khusus / Kendala Teknis:</strong>{' '}
                                            {incidentSummary || 'Tidak ada kendala teknis.'}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    {/* Meta Table Daftar Hadir */}
                                    <table className="w-full mb-[12px] border-collapse" style={{ fontSize: '10pt' }}>
                                        <tbody>
                                            <tr>
                                                <td className="py-[1.5px] w-[125px]">Hari / Tanggal</td>
                                                <td className="py-[1.5px] w-[14px]">:</td>
                                                <td className="py-[1.5px]">{formatIndonesianLongDate(slot.exam_date)}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Ruang &amp; Sesi Ujian</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    {slot.room.name} · {slot.session.name} (
                                                    {slot.session.start_time.substring(0, 5)} -{' '}
                                                    {slot.session.end_time.substring(0, 5)})
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Mata Pelajaran</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">{subjectSummaryLabel}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Rekap Kehadiran</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    Terdaftar: {liveCounts.total} · Hadir: {liveCounts.hadir} · Sakit:{' '}
                                                    {liveCounts.sakit} · Izin: {liveCounts.izin} · Alpha:{' '}
                                                    {liveCounts.alpha}
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="py-[1.5px]">Status Dokumen</td>
                                                <td className="py-[1.5px]">:</td>
                                                <td className="py-[1.5px]">
                                                    {slot.report.status === 'approved' ? (
                                                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                                            <CheckCircle2 size={13} className="text-emerald-700" />
                                                            Resmi &amp; Disahkan
                                                        </span>
                                                    ) : slot.report.status === 'submitted' ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                                                            <Clock size={13} className="text-amber-700" />
                                                            Menunggu ACC Proktor (Draft Daftar Hadir)
                                                        </span>
                                                    ) : slot.report.status === 'rejected' ? (
                                                        <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                                                            <AlertCircle size={13} className="text-red-700" />
                                                            Perlu Perbaikan
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-slate-600 font-bold">
                                                            <Edit size={13} className="text-slate-600" />
                                                            Draft Belum Dikirim
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <table
                                        className="w-full border border-[#333] border-collapse mb-[16px]"
                                        style={{ fontSize: '9pt' }}
                                    >
                                        <thead>
                                            <tr className="bg-[#f1f5f9]">
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[5%] text-center font-normal">
                                                    No
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[14%] text-center font-normal">
                                                    NIS
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[28%] text-center font-normal">
                                                    Nama Peserta
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[12%] text-center font-normal">
                                                    Kelas
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[16%] text-center font-normal">
                                                    Mulai - Selesai
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[10%] text-center font-normal">
                                                    Status
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] text-center font-normal">
                                                    Keterangan
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {slot.students.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={7}
                                                        className="border border-[#333] py-[10px] px-[6px] text-center text-[#555]"
                                                    >
                                                        Tidak ada data peserta di ruang ini
                                                    </td>
                                                </tr>
                                            ) : (
                                                slot.students.map((st, idx) => {
                                                    const stStatus =
                                                        attendanceMap[st.user_id]?.status ||
                                                        st.attendance_status ||
                                                        'hadir';
                                                    const stRemark =
                                                        attendanceMap[st.user_id]?.remark ?? st.remark ?? '';
                                                    return (
                                                        <tr key={st.user_id}>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center">
                                                                {idx + 1}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] whitespace-nowrap">
                                                                {st.nis}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px]">
                                                                {st.full_name}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center whitespace-nowrap">
                                                                {st.class_name}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center whitespace-nowrap">
                                                                {formatClockTime(st.started_at, timeZone)} -{' '}
                                                                {formatClockTime(st.finished_at, timeZone)}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center font-bold">
                                                                {statusLabel(stStatus)}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px]">
                                                                {stRemark || '-'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Approval Footer — Identik dengan .approval-footer Laporan Guru Asuh pada acca-new */}
                            <div className="flex justify-between items-center mt-[20px]">
                                <table className="border-collapse min-w-0 w-full table-fixed" style={{ fontSize: '10pt', overflowWrap: 'anywhere' }}>
                                    <tbody>
                                        <tr>
                                            <td className="py-[4px] w-[135px] align-top">Disahkan pada</td>
                                            <td className="py-[4px] w-[14px] align-top">:</td>
                                            <td className="py-[4px] align-top">
                                                {formatSignedTimestamp(slot.report.signed_at, timeZone)}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="py-[4px] align-top">Pengawas Ruang</td>
                                            <td className="py-[4px] align-top">:</td>
                                            <td className="py-[4px] align-top">
                                                {invigilatorName || slot.report.invigilator_name || '-'}
                                                {slot.report.invigilator_nip && slot.report.invigilator_nip !== '-' && (
                                                    <>
                                                        <br />
                                                        <span className="text-[#555]" style={{ fontSize: '8.5pt' }}>
                                                            NIP. {slot.report.invigilator_nip}
                                                        </span>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="py-[4px] align-top">Proktor</td>
                                            <td className="py-[4px] align-top">:</td>
                                            <td className="py-[4px] align-top">
                                                {slot.report.proctor_name || proctorName || '-'}
                                                {slot.report.proctor_nip && slot.report.proctor_nip !== '-' && (
                                                    <>
                                                        <br />
                                                        <span className="text-[#555]" style={{ fontSize: '8.5pt' }}>
                                                            NIP. {slot.report.proctor_nip}
                                                        </span>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="py-[4px] align-top">Mengetahui,<br />Ketua Panitia</td>
                                            <td className="py-[4px] align-top">:</td>
                                            <td className="py-[4px] align-top">
                                                {slot.report.committee_chair_name || '-'}
                                                {slot.report.committee_chair_nip && <><br /><span className="text-[#555]" style={{ fontSize: '8.5pt' }}>NIP. {slot.report.committee_chair_nip}</span></>}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>

                                <div className="flex flex-col items-center text-center ml-[20px] gap-[2px] shrink-0">
                                    <Image unoptimized width={96} height={96}
                                        src={subView === 'berita_acara_a4' ? baQrSvgUrl : dhQrSvgUrl}
                                        alt="QR Verifikasi"
                                        className="w-[64px] h-[64px] block"
                                    />
                                    <div className="text-[#555] text-center" style={{ fontSize: '7pt' }}>
                                        Pindai untuk verifikasi keaslian dokumen
                                    </div>
                                    <div
                                        className="text-[#777] text-center"
                                        style={{
                                            fontFamily: "'Courier New', monospace",
                                            fontSize: '6.5pt',
                                            letterSpacing: '0.5px',
                                        }}
                                    >
                                        {subView === 'berita_acara_a4' ? baVerificationCode : dhVerificationCode}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )}

    {isRejectModalOpen && rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
            <div className="bg-white w-full max-w-md rounded-2xl p-6 relative shadow-xl">
                <button
                    type="button"
                    onClick={() => setIsRejectModalOpen(false)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-red-50 border border-red-200 rounded-xl flex items-center justify-center text-red-600 shrink-0">
                        <AlertCircle size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-900">Minta Perbaikan Administrasi</h3>
                        <p className="text-xs text-slate-500">
                            Ruang: {rejectTarget.roomName} · Tanggal: {formatIndonesianLongDate(rejectTarget.examDate)}
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            Catatan Revisi untuk Pengawas <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            rows={3}
                            placeholder="Contoh: Mohon periksa kembali absensi siswa yang sakit / lengkapi tanda tangan pengawas..."
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setIsRejectModalOpen(false)}
                            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                            Batal
                        </button>
                        <Button
                            type="button"
                            onClick={() => void handleConfirmReject()}
                            disabled={isRejecting}
                            className="bg-red-600 hover:bg-red-700 text-white text-xs h-9 px-4 rounded-xl flex items-center gap-1.5"
                        >
                            {isRejecting ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                            Kembalikan ke Pengawas
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )}

            {isChairModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
                    <div className="bg-white w-full max-w-md rounded-2xl p-6 relative shadow-xl">
                        <button
                            type="button"
                            onClick={() => setIsChairModalOpen(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-center text-[#3083FF] shrink-0">
                                <UserCheck size={20} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-900">Atur Ketua Panitia Ujian</h3>
                                <p className="text-xs text-slate-500 truncate max-w-[260px]">Folder: {period.name}</p>
                            </div>
                        </div>

                        {chairError && (
                            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                                {chairError}
                            </div>
                        )}

                        <form onSubmit={handleSaveCommitteeChair} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                    Nama Lengkap & Gelar Ketua Panitia <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Contoh: Drs. H. Ahmad Fauzi, M.Pd."
                                    value={chairName}
                                    onChange={(e) => setChairName(e.target.value)}
                                    className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                    NIP Ketua Panitia (Opsional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Contoh: 197805122005011002 atau -"
                                    value={chairNip}
                                    onChange={(e) => setChairNip(e.target.value)}
                                    className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsChairModalOpen(false)}
                                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
                                >
                                    Batal
                                </button>
                                <Button
                                    type="submit"
                                    disabled={isSavingChair || !chairName.trim()}
                                    className="bg-[#3083FF] hover:bg-[#256cd1] text-white text-xs h-9 px-4 rounded-xl flex items-center gap-1.5"
                                >
                                    {isSavingChair ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                    Simpan Perubahan
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
