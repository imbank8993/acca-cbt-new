'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight } from 'lucide-react';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import { listPASMonitoringSlots } from '@/lib/api/pas';

type TodayCounts = { rooms: number; total: number; in_progress: number; finished: number };

/** Jumlah peserta seluruh ruang folder pada hari ini. */
export function sumSlotCounts(slots: Array<{ counts: { total: number; in_progress: number; finished: number } }>): TodayCounts {
    return slots.reduce((sum, slot) => ({
        rooms: sum.rooms + 1,
        total: sum.total + slot.counts.total,
        in_progress: sum.in_progress + slot.counts.in_progress,
        finished: sum.finished + slot.counts.finished,
    }), { rooms: 0, total: 0, in_progress: 0, finished: 0 });
}

/**
 * Kartu status di halaman folder pada hari ujian. Pelaksanaan dipantau di halaman
 * Monitoring (Per bank soal / Per ruang), jadi kartu ini hanya ringkasan + tautan.
 */
export function PASTodayStatusCard({ periodId, today, monitoringHref }: { periodId: string; today: string; monitoringHref: string }) {
    const [counts, setCounts] = useState<TodayCounts | null>(null);
    const request = useRef(0);

    const load = useCallback(async () => {
        const id = ++request.current;
        try {
            const result = await listPASMonitoringSlots({ date: today, periodId });
            if (id === request.current) setCounts(sumSlotCounts(result.date === today ? result.slots : []));
        } catch {
            if (id === request.current) setCounts(null);
        }
    }, [periodId, today]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0);
        return () => window.clearTimeout(timer);
    }, [load]);
    useAutoRefresh(() => void load(), REFRESH_INTERVAL.monitoring);

    const done = counts && counts.total > 0 && counts.finished === counts.total;
    const label = !counts ? 'Ujian hari ini' : done ? 'Selesai hari ini' : counts.in_progress > 0 ? 'Sedang berlangsung' : 'Terjadwal hari ini';

    return <section aria-label="Pelaksanaan hari ini"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
            <Activity size={16} className={counts?.in_progress ? 'text-blue-600' : 'text-slate-400'} aria-hidden="true" />
            <strong className="font-semibold text-slate-900">{label}</strong>
            {counts && counts.rooms > 0 && <>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span><strong className="tabular-nums">{counts.finished}</strong>/<span className="tabular-nums">{counts.total}</span> selesai</span>
                {counts.in_progress > 0 && <><span className="text-slate-300" aria-hidden="true">·</span><span><strong className="tabular-nums">{counts.in_progress}</strong> mengerjakan</span></>}
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>{counts.rooms} ruang</span>
            </>}
        </p>
        <a href={monitoringHref} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Buka di Monitoring <ArrowRight size={13} aria-hidden="true" />
        </a>
    </section>;
}
