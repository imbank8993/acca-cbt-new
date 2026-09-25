"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
    CalendarDays, Clock, CheckCircle2, ArrowRight,
    Ghost, Loader2, AlertCircle, Lock, Unlock, RefreshCw, Sparkles, User
} from 'lucide-react';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/lib/useAutoRefresh';
import { getSessionUser } from '@/lib/session';
import { getStudentExams } from '@/lib/api/students';
import { useRouter } from 'next/navigation';
import { useMemoryState } from '@/lib/useMemoryState';

const SchedulePage = () => {
    const [exams, setExams] = useMemoryState<any[]>('siswa_schedule_exams', []);
    const [loading, setLoading] = useMemoryState('siswa_schedule_loading', true);
    const [now, setNow] = useState(new Date());
    const [fullName, setFullName] = useState<string>('');
    const router = useRouter();

    useEffect(() => {
        loadData();
        // Jam dinding diperbarui tiap menit supaya hitung mundur tetap akurat.
        const interval = setInterval(() => setNow(new Date()), 60000);
        return () => clearInterval(interval);
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        const user = await getSessionUser();
        if (user) {
            setExams((await getStudentExams()) || []);
            setFullName(user.fullName ?? '');
        }
        setLoading(false);
    }, []);

    // Jadwal ujian disegarkan berkala; langganan realtime Supabase sudah tidak ada.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    const getStatus = (exam: any) => {
        // Must be published
        if (!exam.is_published) {
            return { label: 'Belum Publikasi', color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200', icon: Lock, enabled: false };
        }

        // Check if completed
        if (exam.isCompleted) {
            return { label: 'Selesai', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2, enabled: false };
        }

        const startTime = exam.start_time ? new Date(exam.start_time) : null;
        const endTime = exam.end_time ? new Date(exam.end_time) : null;
        const isBeforeStart = startTime && now < startTime;
        const isAfterEnd = endTime && now > endTime;

        // Window not yet open
        if (isBeforeStart) {
            return { label: 'Belum Mulai', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: Clock, enabled: false };
        }

        // Window closed
        if (isAfterEnd) {
            return { label: 'Waktu Habis', color: 'text-red-500', bg: 'bg-red-50 border-red-100', icon: AlertCircle, enabled: false };
        }

        // Window open — student can start
        return { label: 'Kerjakan Sekarang', color: 'text-white', bg: 'bg-[#0038A8] hover:bg-[#020510]', icon: ArrowRight, enabled: true };
    };

    const formatDay = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'TBA';
        try {
            // Parse as UTC by appending 'Z', then format using UTC methods to avoid timezone shift
            const date = new Date(dateStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? dateStr : dateStr + 'Z');
            if (isNaN(date.getTime())) return 'TBA';
            const wibDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
            const day = wibDate.getUTCDate();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const month = months[wibDate.getUTCMonth()];
            const year = wibDate.getUTCFullYear();
            return `${day} ${month} ${year}`;
        } catch (e) {
            console.error('formatDay error:', e, dateStr);
            return 'TBA';
        }
    };

    const formatTimeRange = (startStr: string | null | undefined, endStr: string | null | undefined) => {
        if (!startStr) return 'Kapan saja';
        try {
            // Parse as UTC
            const s = new Date(startStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? startStr : startStr + 'Z');
            const e = endStr ? new Date(endStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? endStr : endStr + 'Z') : null;
            if (isNaN(s.getTime())) return '...';
            
            const sWib = new Date(s.getTime() + (7 * 60 * 60 * 1000));
            const eWib = e && !isNaN(e.getTime()) ? new Date(e.getTime() + (7 * 60 * 60 * 1000)) : null;
 
            const sH = String(sWib.getUTCHours()).padStart(2, '0');
            const sM = String(sWib.getUTCMinutes()).padStart(2, '0');
            const eH = eWib ? String(eWib.getUTCHours()).padStart(2, '0') : '..';
            const eM = eWib ? String(eWib.getUTCMinutes()).padStart(2, '0') : '..';
            return `${sH}:${sM} — ${eH}:${eM} WIB`;
        } catch (e) {
            console.error('formatTimeRange error:', e);
            return '...';
        }
    };

    const formatTimeUntil = (dateStr: string) => {
        if (!dateStr) return '';
        const diff = new Date(dateStr).getTime() - now.getTime();
        if (diff <= 0) return '';
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (days > 0) return `${days}h ${hours}m lagi`;
        if (hours > 0) return `${hours}j ${minutes}m lagi`;
        return `${minutes}m lagi`;
    };

    // Sort exams: published/open first, then by start_time
    const sortedExams = [...exams].sort((a, b) => {
        const aOpen = a.is_published && !a.isCompleted && (!a.end_time || now <= new Date(a.end_time));
        const bOpen = b.is_published && !b.isCompleted && (!b.end_time || now <= new Date(b.end_time));
        if (aOpen && !bOpen) return -1;
        if (!aOpen && bOpen) return 1;
        const aStart = a.start_time ? new Date(a.start_time).getTime() : Infinity;
        const bStart = b.start_time ? new Date(b.start_time).getTime() : Infinity;
        return aStart - bStart;
    });

    const openExams = sortedExams.filter(e => e.is_published && !e.isCompleted && (!e.end_time || now <= new Date(e.end_time)));
    const upcomingExams = sortedExams.filter(e => e.is_published && !e.isCompleted && e.start_time && now < new Date(e.start_time));
    const closedExams = sortedExams.filter(e => e.isCompleted || (e.is_published && e.end_time && now > new Date(e.end_time)));
    const draftExams = sortedExams.filter(e => !e.is_published);

    return (
        );
};

export default SchedulePage;
