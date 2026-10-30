"use client";
import './compact-exam-period.css';

import { CommitteeChairNameInput } from '@/app/components/pas/CommitteeChairNameInput';
import { RoomParticipantsDownload } from '@/app/components/pas/RoomParticipantsDownload';

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
    Save,
    Edit,
    ShieldCheck,
    UserCheck,
    Users,
    X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { FilterActions, FilterField, FilterInput, FilterSearch, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { Modal, ModalBody, ModalField, ModalFooter } from '@/app/components/ui/modal';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { drawAdministrationSigners, resolveAdministrationInvigilators } from '@/lib/pas/administration-signers';
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
import { drawPdfKop } from '@/lib/pas/pdf-kop';
import { loadKopLogo } from '@/lib/school-logo';
import { useKopLogo } from '@/lib/useKopLogo';
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
        canManage?: boolean;
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

type OverviewStatus = 'draft' | 'submitted' | 'rejected' | 'approved';
type OverviewStatusFilter = 'all' | OverviewStatus;

/** Same rule as the status badge, so the filter counts always match what is shown in the list. */
function overviewStatus(item: PASAdministrationOverviewItem): OverviewStatus {
    if (item.status === 'approved' && (item.signature_version || 1) >= 3) return 'approved';
    if (item.status === 'submitted') return 'submitted';
    if (item.status === 'rejected') return 'rejected';
    return 'draft';
}

const OVERVIEW_FILTERS: Array<{ value: OverviewStatusFilter; label: string }> = [
    { value: 'all', label: 'Semua' },
    { value: 'draft', label: 'Draft' },
    { value: 'submitted', label: 'Menunggu persetujuan' },
    { value: 'rejected', label: 'Perlu perbaikan' },
    { value: 'approved', label: 'Disahkan' },
];

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
    const [overviewFilter, setOverviewFilter] = useState<OverviewStatusFilter>('all');
    const [overviewSearch, setOverviewSearch] = useState('');
    const overviewListRef = useRef<HTMLDivElement>(null);

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
    const previewInvigilators = slot ? resolveAdministrationInvigilators(slot.invigilators, slot.report) : [];
    const previewInvigilatorList = previewInvigilators.map((person, index) => (
        <div key={`${person.name}-${index}`} className={index ? 'mt-1' : undefined}>
            {previewInvigilators.length > 1 ? `${index + 1}. ` : ''}{person.name}
            {person.nip && <div className="text-[#555]" style={{ fontSize: '8.5pt' }}>NIP. {person.nip}</div>}
        </div>
    ));
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
                st.identity_number.toLowerCase().includes(q) ||
                st.nis.toLowerCase().includes(q) ||
                st.class_name.toLowerCase().includes(q),
        );
    }, [slot?.students, studentSearch]);

    const pendingApprovalCount = useMemo(() => {
        return overviewItems.filter((i) => i.status === 'submitted').length;
    }, [overviewItems]);

    const overviewCounts = useMemo(() => {
        const counts: Record<OverviewStatusFilter, number> = {
            all: overviewItems.length, draft: 0, submitted: 0, rejected: 0, approved: 0,
        };
        for (const item of overviewItems) counts[overviewStatus(item)] += 1;
        return counts;
    }, [overviewItems]);

    // Filtered list grouped per exam date, ordered by session start time then room name.
    const overviewGroups = useMemo(() => {
        const query = overviewSearch.trim().toLowerCase();
        const matches = overviewItems.filter(item =>
            (overviewFilter === 'all' || overviewStatus(item) === overviewFilter) &&
            (!query || [item.room_name, item.session_name, item.invigilator_name, ...item.assigned_invigilators]
                .some(value => String(value ?? '').toLowerCase().includes(query))));
        matches.sort((a, b) =>
            a.exam_date.localeCompare(b.exam_date) ||
            a.start_time.localeCompare(b.start_time) ||
            a.room_name.localeCompare(b.room_name, 'id', { numeric: true }));
        const groups: Array<{ date: string; items: PASAdministrationOverviewItem[] }> = [];
        for (const item of matches) {
            const last = groups[groups.length - 1];
            if (last?.date === item.exam_date) last.items.push(item);
            else groups.push({ date: item.exam_date, items: [item] });
        }
        return groups;
    }, [overviewItems, overviewFilter, overviewSearch]);

    const showOverviewList = (filter: OverviewStatusFilter) => {
        setOverviewFilter(filter);
        overviewListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

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
    const kopLogo = useKopLogo(kopParts.logoUrl);

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
        const documentInvigilators = resolveAdministrationInvigilators(currentSlot.invigilators, currentSlot.report);
        const invigilatorListHtml = documentInvigilators.map((person, index) => `
            <div${index ? ' style="margin-top:4px;"' : ''}>
              ${documentInvigilators.length > 1 ? `${index + 1}. ` : ''}${escapeHtml(person.name)}
              ${person.nip ? `<br/><span class="ttd-nip">NIP. ${escapeHtml(person.nip)}</span>` : ''}
            </div>`).join('');
        const effectiveProcName = currentSlot.report.proctor_name || '-';
        const effectiveChairName = currentSlot.report.committee_chair_name || '-';
        const effectiveChairNip = currentSlot.report.committee_chair_nip || '';
        const effectiveProcNip = currentSlot.report.proctor_nip || '';

        const kopProfile = currentSlot.profil_sekolah || {
            nama: currentSlot.period.organization_name,
            jenjang: 'MA',
        };
        const kopHtml = renderKopHTML(kopProfile, {
            logoSrc: (await loadKopLogo(formatKopParts(kopProfile).logoUrl))?.dataUrl,
        });

        const rowsHtml = currentSlot.students
            .map((st, idx) => {
                const draft = attendanceMap[st.user_id];
                const stStatus = draft?.status || st.attendance_status || 'hadir';
                const startClock = formatClockTime(st.started_at, timeZone);
                const endClock = formatClockTime(st.finished_at, timeZone);
                return `
                    <tr>
                        <td style="text-align:center;width:5%;">${idx + 1}</td>
                        <td style="width:17%;white-space:nowrap;">${escapeHtml(st.identity_number || '-')}</td>
                        <td style="width:31%;">${escapeHtml(st.full_name)}</td>
                        <td style="width:18%;text-align:left;">${escapeHtml(st.class_name)}</td>
                        <td style="width:19%;text-align:center;white-space:nowrap;">${escapeHtml(startClock)} - ${escapeHtml(endClock)}</td>
                        <td style="width:10%;text-align:center;font-weight:bold;">${escapeHtml(statusLabel(stStatus))}</td>
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
                        <td style="width:16%;white-space:nowrap;">${escapeHtml(st.identity_number || '-')}</td>
                        <td style="width:34%;">${escapeHtml(st.full_name)}</td>
                        <td style="width:14%;text-align:left;">${escapeHtml(st.class_name)}</td>
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
                            <th style="width:16%;">NISN</th>
                            <th style="width:34%;">Nama Peserta</th>
                            <th style="width:14%;text-align:left;">Kelas</th>
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
                            <th style="width:17%;">NISN</th>
                            <th style="width:31%;">Nama Peserta</th>
                            <th style="width:18%;text-align:left;">Kelas</th>
                            <th style="width:19%;">Mulai - Selesai</th>
                            <th style="width:10%;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            rowsHtml ||
                            `<tr><td colspan="6" style="text-align:center;padding:10px;">Tidak ada data peserta di ruang ini</td></tr>`
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
              ${invigilatorListHtml}
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
        const documentInvigilators = resolveAdministrationInvigilators(currentSlot.invigilators, currentSlot.report);
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

        // KOP Sekolah: logo profil sekolah + teks Kementerian Agama, sama dengan semua dokumen ujian.
        const centerX = marginLeft + contentW / 2;
        const kopLogo = await loadKopLogo(kParts.logoUrl);
        y = drawPdfKop(pdf, kParts, kopLogo, { left: marginLeft, right: pageW - marginRight, top: 10 }) + 5.6;

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

            const absWidths = [10, 27, 51, 40, 47];
            const absHeaders = ['No', 'NISN', 'Nama Peserta', 'Kelas', 'Status & Keterangan'];
            let cx = marginLeft;
            const drawAbsentHeader = () => {
                cx = marginLeft;
                pdf.setFont('times', 'normal'); pdf.setFontSize(9);
                for (let i = 0; i < absHeaders.length; i++) {
                    pdf.setFillColor(241, 245, 249);
                    pdf.rect(cx, y, absWidths[i], 6.2, 'F');
                    pdf.rect(cx, y, absWidths[i], 6.2, 'S');
                    pdf.text(absHeaders[i], i === 3 ? cx + 2 : cx + absWidths[i] / 2, y + 4.2,
                        { align: i === 3 ? 'left' : 'center' });
                    cx += absWidths[i];
                }
                y += 6.2;
            };
            drawAbsentHeader();

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
                        st.identity_number || '-',
                        st.full_name,
                        st.class_name || '-',
                        `${statusLabel(st.effectiveStatus)}${st.effectiveRemark ? ` — ${st.effectiveRemark}` : ''}`,
                    ];
                    const lines = rowCells.map((cell, column) => pdf.splitTextToSize(cell, absWidths[column] - 4) as string[]);
                    const rowHeight = Math.max(6, ...lines.map(item => item.length * 3.7 + 2));
                    if (y + rowHeight > 242) {
                        pdf.addPage(); y = 16;
                        drawAbsentHeader();
                    }
                    cx = marginLeft;
                    for (let i = 0; i < lines.length; i++) {
                        pdf.rect(cx, y, absWidths[i], rowHeight);
                        pdf.text(lines[i], cx + 2, y + 4.1, { lineHeightFactor: 1.16 });
                        cx += absWidths[i];
                    }
                    y += rowHeight;
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
            const colWidths = [9, 27, 50, 38, 34, 17];
            const headers = ['No', 'NISN', 'Nama Peserta', 'Kelas', 'Mulai-Selesai', 'Status'];
            let cx = marginLeft;
            const drawAttendanceHeader = () => {
                cx = marginLeft;
                pdf.setFont('times', 'normal'); pdf.setFontSize(8.8);
                pdf.setTextColor(0, 0, 0);
                for (let i = 0; i < headers.length; i++) {
                    pdf.setFillColor(241, 245, 249);
                    pdf.rect(cx, y, colWidths[i], 6.2, 'F');
                    pdf.rect(cx, y, colWidths[i], 6.2, 'S');
                    pdf.text(headers[i], i === 3 ? cx + 1.5 : cx + colWidths[i] / 2, y + 4.2,
                        { align: i === 3 ? 'left' : 'center' });
                    cx += colWidths[i];
                }
                y += 6.2;
            };
            drawAttendanceHeader();

            pdf.setFont('times', 'normal');
            pdf.setFontSize(8.5);
            for (let idx = 0; idx < currentSlot.students.length; idx++) {
                const st = currentSlot.students[idx];
                const draft = attendanceMap[st.user_id];
                const stStatus = draft?.status || st.attendance_status || 'hadir';
                const timeRange = `${formatClockTime(st.started_at, timeZone)} - ${formatClockTime(st.finished_at, timeZone)}`;
                const cells = [
                    String(idx + 1),
                    st.identity_number || '-',
                    st.full_name,
                    st.class_name || '-',
                    timeRange,
                    statusLabel(stStatus),
                ];
                const lines = cells.map((cell, column) => pdf.splitTextToSize(cell, colWidths[column] - 3) as string[]);
                const rowHeight = Math.max(5.8, ...lines.map(item => item.length * 3.5 + 2));
                if (y + rowHeight > 242) {
                    pdf.addPage();
                    y = 16;
                    drawAttendanceHeader();
                    pdf.setFont('times', 'normal'); pdf.setFontSize(8.5);
                }
                cx = marginLeft;
                for (let i = 0; i < lines.length; i++) {
                    pdf.rect(cx, y, colWidths[i], rowHeight);
                    pdf.text(lines[i], cx + 1.5, y + 3.8, { lineHeightFactor: 1.16 });
                    cx += colWidths[i];
                }
                y += rowHeight;
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
            invigilators: documentInvigilators,
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
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
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
        <div className="pas-administration space-y-4">
            {/* ── Navigasi tampilan (pill) + ketua panitia ── */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div role="group" aria-label="Tampilan administrasi" className="pas-administration__tabs inline-flex max-w-full self-start overflow-x-auto rounded-full border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold">
                    {([
                        ...(resolvedRole !== 'pengawas' ? [['overview', 'Ringkasan']] : []),
                        ['editor', 'Absensi & Berita Acara'],
                        ['berita_acara_a4', 'Berita Acara'],
                        ['daftar_hadir_a4', 'Daftar Hadir'],
                    ] as Array<[AdminSubView, string]>).map(([id, label]) =>
                        <button key={id} type="button" aria-pressed={subView === id} onClick={() => setSubView(id)}
                            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors ${subView === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                            {label}
                        </button>)}
                </div>
                <div className="flex items-center gap-2.5 self-start rounded-xl border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-xs lg:self-auto">
                    <UserCheck size={15} className="shrink-0 text-blue-600" aria-hidden="true" />
                    <div className="min-w-0 leading-tight">
                        <p className="text-[10.5px] text-slate-500">Ketua panitia</p>
                        <p className="max-w-[220px] truncate font-semibold text-slate-800">
                            {slot?.committee_chair?.committee_chair_name || period.committee_chair_name || 'Belum diatur'}
                        </p>
                    </div>
                    {!period.is_locked && period.canManage !== false && <Button type="button" variant="ghost" size="sm" onClick={openChairModal}>Atur</Button>}
                </div>
            </div>

            {subView === 'overview' ? (
                <div className="space-y-4">
                    {/* ── Dokumen ujian: semua unduhan folder di satu tempat ── */}
                    <section aria-labelledby="pas-exam-documents" className="space-y-3">
                        <div>
                            <h3 id="pas-exam-documents" className="text-sm font-semibold text-slate-900">Dokumen ujian</h3>
                            <p className="mt-0.5 text-xs text-slate-500">Unduh dokumen folder dengan kop sekolah, siap cetak A4.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                                <div className="flex items-start gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#3083FF]">
                                        <Printer size={17} />
                                    </span>
                                    <div className="min-w-0">
                                        <h4 className="text-sm font-semibold text-slate-900">Jadwal Pelaksanaan</h4>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {period.pas_class_schedules?.length
                                                ? `${period.pas_class_schedules.length} jadwal kelas · ${rooms.length} ruang · ${sessions.length} sesi`
                                                : 'Belum ada jadwal kelas'}
                                        </p>
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" className="mt-auto w-full"
                                    disabled={isPrintingSchedule || !period.pas_class_schedules?.length}
                                    isLoading={isPrintingSchedule} onClick={() => void handleDownloadSchedule()}
                                    leftIcon={<Download size={14} />}>
                                    Unduh PDF
                                </Button>
                            </div>

                            {resolvedRole !== 'pengawas' && <RoomParticipantsDownload period={{
                                ...period,
                                profil_sekolah: period.profil_sekolah || slot?.profil_sekolah,
                            }} rooms={rooms} />}

                            <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                                <div className="flex items-start gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                                        <FileCheck2 size={17} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="text-sm font-semibold text-slate-900">Berita Acara &amp; Daftar Hadir</h4>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            <span className="font-semibold tabular-nums text-slate-800">
                                                {overviewCounts.approved}/{overviewCounts.all}
                                            </span> disahkan
                                        </p>
                                    </div>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                                    <div className="h-full rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${overviewCounts.all ? Math.round((overviewCounts.approved / overviewCounts.all) * 100) : 0}%` }} />
                                </div>
                                {pendingApprovalCount > 0 && (
                                    <Button type="button" variant="ghost" size="sm" className="self-start text-amber-700" onClick={() => showOverviewList('submitted')}>
                                        {pendingApprovalCount} menunggu persetujuan
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" className="mt-auto w-full"
                                    disabled={!overviewCounts.all}
                                    onClick={() => showOverviewList('all')}>
                                    Lihat per ruang ↓
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* Table of all slots */}
                    <div ref={overviewListRef} className="scroll-mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900">Berita acara per ruang</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">Periksa dan sahkan dokumen yang dikirim pengawas.</p>
                                </div>
                                <FilterToolbar className="sm:min-w-[340px]" actionsInline>
                                    <FilterSearch value={overviewSearch} onChange={setOverviewSearch} placeholder="Cari ruang / pengawas" width="220px" />
                                    <FilterActions>
                                        <Button type="button" variant="outline" size="sm" icon="refresh" onClick={() => void loadOverview()}
                                            disabled={isLoadingOverview} title="Segarkan data">Segarkan</Button>
                                    </FilterActions>
                                </FilterToolbar>
                            </div>
                            <div role="tablist" aria-label="Filter status dokumen" className="flex gap-1.5 overflow-x-auto pb-0.5">
                                {OVERVIEW_FILTERS
                                    .filter(filter => filter.value !== 'rejected' || overviewCounts.rejected > 0)
                                    .map(filter => {
                                        const active = overviewFilter === filter.value;
                                        const count = overviewCounts[filter.value];
                                        const attention = (filter.value === 'submitted' || filter.value === 'rejected') && count > 0;
                                        return (
                                            <button
                                                key={filter.value}
                                                type="button"
                                                role="tab"
                                                aria-selected={active}
                                                onClick={() => setOverviewFilter(filter.value)}
                                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                                                    active
                                                        ? 'border-[#3083FF] bg-[#3083FF] text-white'
                                                        : attention
                                                            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                                }`}
                                            >
                                                {filter.label}
                                                <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                                                    active ? 'bg-white/25 text-white' : attention ? 'bg-amber-200/70 text-amber-900' : 'bg-slate-100 text-slate-600'
                                                }`}>{count}</span>
                                            </button>
                                        );
                                    })}
                            </div>
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
                        ) : overviewGroups.length === 0 ? (
                            <div className="p-10 text-center text-xs text-slate-500">
                                Tidak ada dokumen yang cocok dengan filter ini.{' '}
                                <Button type="button" variant="ghost" size="sm" onClick={() => { setOverviewFilter('all'); setOverviewSearch(''); }}>
                                    Tampilkan semua
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-xs font-medium text-slate-500">
                                            <th className="py-3 px-4">Ruang &amp; Sesi</th>
                                            <th className="py-3 px-3">Pengawas</th>
                                            <th className="py-3 px-3 text-center">Kehadiran</th>
                                            <th className="py-3 px-3">Status</th>
                                            <th className="py-3 px-4 text-right">Aksi</th>
                                        </tr>
                                    </thead>
                                    {overviewGroups.map(group => (
                                    <tbody key={group.date} className="divide-y divide-slate-100 border-b border-slate-100 last:border-b-0">
                                        <tr className="bg-slate-50/80">
                                            <th colSpan={5} scope="colgroup" className="px-4 py-2 text-left text-[11px] font-semibold text-slate-600">
                                                {formatIndonesianLongDate(group.date)}
                                                <span className="ml-2 font-normal text-slate-400">{group.items.length} ruang &amp; sesi</span>
                                            </th>
                                        </tr>
                                        {group.items.map((item) => {
                                            const status = overviewStatus(item);
                                            const isSubmitted = status === 'submitted';
                                            const isApproved = status === 'approved';
                                            const isRejected = status === 'rejected';

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
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                                                <CheckCircle2 size={12} />Disahkan
                                                            </span>
                                                        ) : isSubmitted ? (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                                                                <Clock size={12} />Menunggu ACC
                                                            </span>
                                                        ) : isRejected ? (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200" title={item.rejection_note || 'Perlu perbaikan'}>
                                                                <AlertCircle size={12} />Perlu perbaikan
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                                                                <Edit size={12} />Draft
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                                        <div className="inline-flex items-center gap-1.5">
                                                            {isSubmitted && (
                                                                <Button type="button" variant="activate" size="sm" disabled={isApproving} title="ACC menjadi dokumen resmi"
                                                                    leftIcon={<CheckCircle2 size={14} />}
                                                                    onClick={() => void handleApproveSlot({ roomId: item.room_id, sessionId: item.session_id, examDate: item.exam_date })}>
                                                                    ACC
                                                                </Button>
                                                            )}
                                                            <Button type="button" variant="outline" size="sm" onClick={() => {
                                                                setSelectedRoomId(item.room_id);
                                                                setSelectedSessionId(item.session_id);
                                                                setSelectedDate(item.exam_date);
                                                                setSubView('editor');
                                                            }}>
                                                                {isSubmitted ? 'Periksa' : 'Buka'}
                                                            </Button>
                                                            {isSubmitted && (
                                                                <Button type="button" variant="ghost" size="sm" className="text-red-600" leftIcon={<X size={14} />}
                                                                    aria-label="Minta perbaikan" title="Minta Perbaikan / Kembalikan ke Pengawas"
                                                                    onClick={() => handleOpenRejectModal({ roomId: item.room_id, sessionId: item.session_id, examDate: item.exam_date, roomName: item.room_name })} />
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    ))}
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* ── Filter: Ruang + Sesi + Tanggal ── */}
                    <div className="rounded-xl border border-slate-200 bg-white px-4 pb-3 pt-2">
                    <FilterToolbar alwaysExpanded>
                        <FilterField label="Ruang ujian" bare width="220px">
                            <InlineSelect value={selectedRoomId} onChange={setSelectedRoomId} title="Pilih ruang ujian" minWidth="100%" height="38px"
                                aria-label="Ruang ujian" options={rooms.map(r => ({ value: r.id, label: r.name }))} />
                        </FilterField>
                        <FilterField label="Sesi ujian" bare width="240px">
                            <InlineSelect value={selectedSessionId} onChange={setSelectedSessionId} title="Pilih sesi ujian" minWidth="100%" height="38px"
                                aria-label="Sesi ujian" options={sessions.map(s => ({ value: s.id, label: `${s.name} (${s.start_time.substring(0, 5)}–${s.end_time.substring(0, 5)})` }))} />
                        </FilterField>
                        <FilterInput label="Tanggal pelaksanaan" icon="calendar3" type="date" value={selectedDate} onChange={setSelectedDate} width="180px"
                            min={period.start_date?.split('T')[0] || undefined} max={period.end_date?.split('T')[0] || undefined} />
                        <FilterActions>
                            <Button type="button" variant="outline" size="sm" icon="refresh" onClick={() => void loadSlot()} disabled={isLoading}
                                title="Muat ulang data absensi & waktu ujian">Muat ulang</Button>
                        </FilterActions>
                    </FilterToolbar>
                    </div>

                    {loadError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center justify-between">
                            <span>{loadError}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void loadSlot()}>Muat ulang</Button>
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
                        <div className="bg-white rounded-xl border border-slate-200 p-16 flex flex-col items-center justify-center gap-2">
                            <Loader2 size={28} className="animate-spin text-[#3083FF]" />
                            <p className="text-xs text-slate-500 font-medium">Memuat data peserta, waktu ujian, dan Berita Acara...</p>
                        </div>
                    ) : subView === 'editor' ? (
                        <div className="space-y-4">
                            {/* ── Status dokumen ── */}
                            <div className={`flex flex-col gap-3 rounded-xl border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                                slot.report.status === 'approved' ? 'border-emerald-200' : slot.report.status === 'submitted' ? 'border-amber-300' : slot.report.status === 'rejected' ? 'border-red-200' : 'border-slate-200'
                            }`}>
                                <div className="flex min-w-0 items-start gap-3">
                                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                        slot.report.status === 'approved' ? 'bg-emerald-50 text-emerald-600'
                                            : slot.report.status === 'submitted' ? 'bg-amber-50 text-amber-600'
                                            : slot.report.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                                    }`} aria-hidden="true">
                                        {slot.report.status === 'approved' ? <ShieldCheck size={16} /> : slot.report.status === 'submitted' ? <Clock size={16} />
                                            : slot.report.status === 'rejected' ? <AlertCircle size={16} /> : <Edit size={16} />}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900">
                                            {slot.report.status === 'approved' ? 'Dokumen resmi & disahkan'
                                                : slot.report.status === 'submitted' ? 'Menunggu ACC proktor'
                                                : slot.report.status === 'rejected' ? 'Perlu perbaikan' : 'Draft'}
                                            {slot.report.submitted_at && slot.report.status === 'submitted' && (
                                                <span className="ml-2 text-xs font-normal text-slate-500">Dikirim {formatSignedTimestamp(slot.report.submitted_at, timeZone)}</span>
                                            )}
                                            {slot.report.approved_at && slot.report.status === 'approved' && (
                                                <span className="ml-2 text-xs font-normal text-slate-500">oleh {slot.report.proctor_name || 'Proktor'} · {formatSignedTimestamp(slot.report.approved_at, timeZone)}</span>
                                            )}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {slot.report.status === 'approved'
                                                ? 'Dokumen resmi siap diunduh dan diverifikasi.'
                                                : slot.report.status === 'submitted'
                                                  ? 'Periksa absensi dan berita acara sebelum mengesahkan.'
                                                  : slot.report.status === 'rejected'
                                                    ? `Catatan proktor: "${slot.report.rejection_note || 'Perlu perbaikan.'}"`
                                                    : 'Isi absensi dan berita acara, lalu kirim ke proktor.'}
                                        </p>
                                        {slot.report.is_saved && slot.report.signature_version < 3 && (
                                            <p className="mt-1 text-xs font-medium text-amber-700">Dokumen lama perlu diperiksa dan di-ACC ulang.</p>
                                        )}
                                    </div>
                                </div>

                                {resolvedRole !== 'pengawas' && period.canManage !== false && (slot.report.status !== 'approved' || slot.report.signature_version < 3) && (
                                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                        {slot.report.status === 'submitted' && (
                                            <Button variant="outline" size="sm" onClick={() => handleOpenRejectModal()}
                                                disabled={isLoading || isApproving} className="text-red-700" leftIcon={<AlertCircle size={14} />}>
                                                Minta perbaikan
                                            </Button>
                                        )}
                                        <Button variant="primary" size="sm" onClick={() => void handleApproveSlot()}
                                            disabled={isLoading || isApproving} isLoading={isApproving} leftIcon={<CheckCircle2 size={14} />}>
                                            ACC dokumen resmi
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
                                <Button type="button" variant="ghost" size="sm" onClick={syncFromExamActivity}
                                    title="Set Hadir untuk peserta yang tercatat mulai ujian">Sinkron aktivitas</Button>
                                <Button type="button" variant="outline" size="sm" onClick={markAllHadir}
                                    leftIcon={<Check size={14} />}>Tandai semua hadir</Button>
                            </div>}
                        </div>

                        {slot.students.length > 0 && (liveCounts.sakit > 0 || liveCounts.izin > 0 || liveCounts.alpha > 0 || slot.students.length > 8 || studentSearch.trim().length > 0) && (
                        <div className="px-4 py-2 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3 flex-wrap text-xs text-slate-600">
                                {liveCounts.sakit > 0 && <span>Sakit <strong className="text-amber-700">{liveCounts.sakit}</strong></span>}
                                {liveCounts.izin > 0 && <span>Izin <strong className="text-blue-700">{liveCounts.izin}</strong></span>}
                                {liveCounts.alpha > 0 && <span>Alpha <strong className="text-red-700">{liveCounts.alpha}</strong></span>}
                            </div>
                            {(slot.students.length > 8 || studentSearch.trim().length > 0) && <div className="w-full sm:w-64 sm:ml-auto">
                                <FilterToolbar alwaysExpanded>
                                    <FilterSearch value={studentSearch} onChange={setStudentSearch} placeholder="Cari nama, NISN, kelas…" width="100%" />
                                </FilterToolbar>
                            </div>}
                        </div>
                        )}

                        {/* Table */}
                        {slot.students.length === 0 ? (
                            <p className="px-5 py-8 text-center text-xs text-slate-500">
                                Belum ada peserta yang ditempatkan di ruang ini.
                            </p>
                        ) : <div className="overflow-x-auto">
                            <table className="pas-attendance-table w-full text-left border-collapse">
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
                                                            NISN: {st.identity_number || '-'} · <span className="font-medium text-slate-700">{st.class_name}</span>
                                                        </div>
                                                    </td>
                                                    <td data-label="Waktu ujian" className="py-2.5 px-3">
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
                                                    <td data-label="Kehadiran" className="py-2.5 px-3">
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
                                                                    aria-pressed={currentStatus === opt.id}
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
                                                    <td data-label="Keterangan" className="py-2.5 px-3">
                                                        <input
                                                            type="text"
                                                            value={currentRemark}
                                                            aria-label={`Keterangan ${st.full_name}`}
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
                        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
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
                                    <Button type="button" variant="ghost" size="sm" aria-expanded={showIncidentDetails} aria-controls="pas-incident-summary"
                                        onClick={() => setShowIncidentDetails((open) => !open)}>
                                        {showIncidentDetails ? 'Sembunyikan kejadian khusus' : hasNotableIncident(incidentSummary) ? 'Lihat kejadian khusus' : '+ Tambah kejadian khusus / kendala'}
                                    </Button>
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
                                            leftIcon={<CheckCircle2 size={14} />}
                                        >
                                            Kirim ke proktor
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
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{subView === 'berita_acara_a4' ? 'Berita Acara' : 'Daftar Hadir Peserta'}</p>
                            <p className="mt-0.5 text-xs text-slate-500">Pratinjau A4 potret · kode verifikasi {subView === 'berita_acara_a4' ? baVerificationCode : dhVerificationCode}</p>
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

                    <div className="flex justify-center overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4 sm:p-8">
                        <div
                            className="bg-white shadow-xl border border-slate-300 text-black w-[794px] min-h-[1123px] p-[10mm_15mm_15mm_20mm] shrink-0"
                            style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '10.5pt', lineHeight: 1.38 }}
                        >
                            {/* KOP SURAT RESMI (Sama persis dengan KOP Laporan Guru Asuh pada acca-new) */}
                            <div className="grid grid-cols-[84px_minmax(0,1fr)_84px] items-center gap-x-[10px] min-h-[84px]">
                                <div className="flex h-[84px] w-[84px] items-center justify-center">
                                    {(kopLogo?.dataUrl || kopParts.logoUrl) && (
                                        <Image unoptimized width={84} height={84}
                                            src={kopLogo?.dataUrl || kopParts.logoUrl}
                                            alt={`Logo ${kopParts.namaMadrasah}`}
                                            className="max-h-[84px] max-w-[84px] h-auto w-auto object-contain"
                                        />
                                    )}
                                </div>
                                <div className="min-w-0 text-center">
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
                                <div aria-hidden="true" />
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
                                                    NISN
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[34%] text-center font-normal">
                                                    Nama Peserta
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[14%] text-left font-normal">
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
                                                            {st.identity_number || '-'}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px]">
                                                            {st.full_name}
                                                        </td>
                                                        <td className="border border-[#333] py-[5px] px-[6px] text-left">
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
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[17%] text-center font-normal">
                                                    NISN
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[31%] text-center font-normal">
                                                    Nama Peserta
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[18%] text-left font-normal">
                                                    Kelas
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[19%] text-center font-normal">
                                                    Mulai - Selesai
                                                </th>
                                                <th className="border border-[#333] py-[5px] px-[6px] w-[10%] text-center font-normal">
                                                    Status
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {slot.students.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={6}
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
                                                    return (
                                                        <tr key={st.user_id}>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center">
                                                                {idx + 1}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] whitespace-nowrap">
                                                                {st.identity_number || '-'}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px]">
                                                                {st.full_name}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-left">
                                                                {st.class_name}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center whitespace-nowrap">
                                                                {formatClockTime(st.started_at, timeZone)} -{' '}
                                                                {formatClockTime(st.finished_at, timeZone)}
                                                            </td>
                                                            <td className="border border-[#333] py-[5px] px-[6px] text-center font-bold">
                                                                {statusLabel(stStatus)}
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
                                                {previewInvigilatorList}
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

    <Modal open={isRejectModalOpen && Boolean(rejectTarget)} onClose={() => setIsRejectModalOpen(false)} size="md" variant="delete"
        labelledBy="pas-reject-title" title="Minta Perbaikan Administrasi" icon={<AlertCircle size={18} />}
        subtitle={rejectTarget ? `Ruang ${rejectTarget.roomName} · ${formatIndonesianLongDate(rejectTarget.examDate)}` : undefined}>
        <ModalBody>
            <ModalField label="Catatan revisi untuk pengawas" required>
                <textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Contoh: Mohon periksa kembali absensi siswa yang sakit / lengkapi tanda tangan pengawas..." />
            </ModalField>
        </ModalBody>
        <ModalFooter>
            <Button type="button" variant="cancel" onClick={() => setIsRejectModalOpen(false)}>Batal</Button>
            <Button type="button" variant="danger" isLoading={isRejecting} disabled={isRejecting || !rejectNote.trim()}
                leftIcon={<AlertCircle size={15} />} onClick={() => void handleConfirmReject()}>Kembalikan ke Pengawas</Button>
        </ModalFooter>
    </Modal>

            <Modal open={isChairModalOpen} onClose={() => setIsChairModalOpen(false)} size="md" variant="edit"
                labelledBy="pas-chair-title" title="Atur Ketua Panitia Ujian" icon={<UserCheck size={18} />} subtitle={`Folder: ${period.name}`}>
                <form onSubmit={handleSaveCommitteeChair}>
                    <ModalBody>
                        {chairError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{chairError}</div>}
                        <div className="space-y-4">
                            <ModalField label="Nama lengkap & gelar ketua panitia" required>
                                <CommitteeChairNameInput required value={chairName} nip={chairNip}
                                    onChange={(name, nip) => { setChairName(name); setChairNip(nip); }} />
                            </ModalField>
                            <ModalField label="NIP ketua panitia" hint="Opsional. Isi tanda - bila tidak ada.">
                                <input type="text" value={chairNip} onChange={(e) => setChairNip(e.target.value)} placeholder="Contoh: 197805122005011002" />
                            </ModalField>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="cancel" onClick={() => setIsChairModalOpen(false)}>Batal</Button>
                        <Button type="submit" variant="primary" icon="save" isLoading={isSavingChair} disabled={isSavingChair || !chairName.trim()}>Simpan</Button>
                    </ModalFooter>
                </form>
            </Modal>
        </div>
    );
}
