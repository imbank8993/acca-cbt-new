'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Clock, DoorOpen, Loader2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import { activeMonitoringRows } from '@/lib/active-monitoring';
import { listPASMonitoringSlots, type PASMonitoringSlot } from '@/lib/api/pas';
import { finishAttemptAction, getExamAttemptsAction, type ExamAttemptRecord, type OrganizationExam } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';
import { schoolTodayDate, utcToSchoolLocalDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';

type StaffRole = 'admin' | 'proktor' | 'pengawas';

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
export const formatSlotDate = (date: string) => isDay(date)
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : date;
const hm = (value: string) => String(value || '').slice(0, 5);
const FINISHED = ['submitted', 'auto_submitted', 'finished', 'completed', 'selesai'];

/** Tanggal awal: hari ini bila ada, lalu tanggal terdekat berikutnya, lalu tanggal terakhir. */
export function pickSlotDate(dates: string[], today: string): string {
    return dates.includes(today) ? today : dates.find(date => date > today) || dates[dates.length - 1] || '';
}

/** Slot awal untuk pengawas: sesi yang sedang berjalan, lalu yang berikutnya, lalu yang pertama. */
export function pickCurrentSlot(slots: PASMonitoringSlot[], nowTime: string): PASMonitoringSlot | null {
    const mine = slots.filter(slot => slot.is_mine);
    const list = mine.length ? mine : slots;
    return list.find(slot => hm(slot.session.start_time) <= nowTime && nowTime < hm(slot.session.end_time))
        || list.find(slot => hm(slot.session.start_time) > nowTime)
        || list[0] || null;
}

/** Peserta satu ruang: gabungan beberapa ujian, disaring ke siswa yang duduk di ruang itu. */
export function slotAttempts(slot: PASMonitoringSlot, attemptsByExam: Record<string, ExamAttemptRecord[]>): ExamAttemptRecord[] {
    const seated = new Set(slot.student_ids);
    const seen = new Set<string>();
    const rows: ExamAttemptRecord[] = [];
    for (const exam of slot.exams) {
        for (const attempt of attemptsByExam[exam.exam_id] || []) {
            const inRoom = attempt.pas_location?.room_id ? attempt.pas_location.room_id === slot.room.id : seated.has(attempt.user_id);
            const key = `${attempt.exam_id}:${attempt.user_id}:${attempt.id}`;
            if (!inRoom || seen.has(key)) continue;
            seen.add(key);
            rows.push(attempt);
        }
    }
    return rows;
}

function SlotCard({ slot, active, onSelect }: { slot: PASMonitoringSlot; active: boolean; onSelect: () => void }) {
    const { total, in_progress: running, finished, not_started: waiting } = slot.counts;
    const tone = total > 0 && finished === total ? 'border-emerald-200 bg-emerald-50/50'
        : running > 0 ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white';
    return <button type="button" onClick={onSelect} aria-pressed={active}
        className={`w-full rounded-xl border p-3 text-left transition hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${tone} ${active ? 'ring-2 ring-blue-500/40' : ''}`}>
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900"><DoorOpen size={14} className="shrink-0 text-blue-600" />{slot.room.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{slot.exams.map(exam => exam.class_name).join(', ')}</p>
            </div>
            {slot.is_mine && <span className="shrink-0 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Tugas saya</span>}
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Mengerjakan</dt><dd className="font-bold tabular-nums text-blue-700">{running}</dd></div>
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Selesai</dt><dd className="font-bold tabular-nums text-emerald-700">{finished}</dd></div>
            <div className="rounded-md bg-white/70 px-1 py-1"><dt className="text-slate-500">Belum</dt><dd className="font-bold tabular-nums text-slate-700">{waiting}</dd></div>
        </dl>
        <p className="mt-2 truncate text-[11px] text-slate-500"><ShieldCheck size={11} className="mr-1 inline text-slate-400" />
            {slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : <span className="text-amber-700">Pengawas belum diatur</span>}</p>
    </button>;
}

function RoomMonitor({ slot, userRole, monitoringBasePath, attemptBasePath, onBack }: {
    slot: PASMonitoringSlot; userRole: StaffRole; monitoringBasePath: string; attemptBasePath?: string; onBack?: () => void;
}) {
    const router = useRouter();
    const [attemptsByExam, setAttemptsByExam] = useState<Record<string, ExamAttemptRecord[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<'live' | 'list' | 'admin'>('live');
    const [search, setSearch] = useState('');
    const [attentionOnly, setAttentionOnly] = useState(false);
    const request = useRef(0);

    const load = useCallback(async (silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        setError(null);
        const results = await Promise.allSettled(slot.exams.map(exam => getExamAttemptsAction(exam.exam_id)));
        if (id !== request.current) return;
        const next: Record<string, ExamAttemptRecord[]> = {};
        const failures: string[] = [];
        results.forEach((result, index) => {
            const exam = slot.exams[index];
            if (result.status === 'fulfilled') next[exam.exam_id] = result.value;
            else failures.push(`${exam.class_name} (${exam.bank_title})`);
        });
        setAttemptsByExam(next);
        if (failures.length) setError(`Peserta ujian ${failures.join(', ')} belum dapat dimuat.`);
        setLoading(false);
    }, [slot]);

    useEffect(() => {
        setAttemptsByExam({});
        void load(false);
    }, [load]);
    useAutoRefresh(() => void load(true), REFRESH_INTERVAL.monitoring);

    const examLabel = useMemo(() => new Map(slot.exams.map(exam => [exam.exam_id, `${exam.class_name} · ${exam.bank_title}`])), [slot.exams]);
    const attempts = useMemo(() => slotAttempts(slot, attemptsByExam), [slot, attemptsByExam]);
    const query = search.trim().toLocaleLowerCase('id-ID');
    const filtered = attempts.filter(attempt => !query || [attempt.profiles?.full_name, attempt.profiles?.identity_number, attempt.kelas_name, examLabel.get(attempt.exam_id)]
        .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
    const running = attempts.filter(attempt => attempt.status === 'in_progress').length;
    const finished = attempts.filter(attempt => FINISHED.includes(attempt.status)).length;
    const attention = activeMonitoringRows(attempts, 'attention').length;
    const canFinish = userRole !== 'pengawas';
    const finish = async (attempt: ExamAttemptRecord, reason: string) => {
        const result = await finishAttemptAction(attempt.id, reason);
        if (!result.success) return result.error || 'Pengerjaan belum dapat diselesaikan.';
        await load(true);
        return null;
    };
    const administrationExam = {
        id: slot.exams[0]?.exam_id, exam_type: slot.period.type, title: slot.period.name,
        metadata: { pas_period_id: slot.period.id, pas_schedule_id: slot.exams[0]?.schedule_id },
    } as unknown as OrganizationExam;

    return <section className="space-y-4" aria-label={`Monitoring ${slot.room.name} ${slot.session.name}`}>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    {onBack && <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><ArrowLeft size={13} />Semua ruang</button>}
                    <h2 className="text-base font-bold text-slate-900">{slot.room.name} · {slot.session.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-500"><Clock size={12} className="mr-1 inline" />{formatSlotDate(slot.date)} · {hm(slot.session.start_time)}–{hm(slot.session.end_time)} · {slot.period.name}</p>
                    <p className="mt-1 text-xs text-slate-500"><ShieldCheck size={12} className="mr-1 inline" />Pengawas: {slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : 'belum diatur'}</p>
                </div>
                <button type="button" onClick={() => void load(false)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Perbarui data ruang">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Perbarui
                </button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[['Peserta di ruang', attempts.length || slot.counts.total], ['Mengerjakan', running], ['Selesai', finished], ['Belum masuk', Math.max(0, (attempts.length || slot.counts.total) - running - finished)], ['Perlu perhatian', attention]].map(([label, value], index) =>
                    <div key={label} className={`rounded-lg border px-3 py-2 ${index === 4 && Number(value) > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50/60'}`}>
                        <dt className="text-[11px] text-slate-500">{label}</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{value}</dd></div>)}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Ujian di ruang ini">
                {slot.exams.map(exam => <a key={exam.exam_id} href={`${monitoringBasePath}?exam=${encodeURIComponent(exam.exam_id)}`}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700"
                    title="Buka monitoring per ujian (jawaban, reset, hasil)">{exam.class_name} · {exam.bank_title} <span className="text-slate-400">({exam.student_count})</span></a>)}
            </div>
        </div>

        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold" aria-label="Bagian monitoring ruang">
            {([['live', 'Peserta aktif'], ['list', 'Daftar peserta'], ['admin', 'Absensi & berita acara']] as const).map(([id, label]) =>
                <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
                    className={`flex-1 rounded-md px-3 py-2 ${tab === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>)}
        </nav>

        {tab !== 'admin' && <div className="flex flex-wrap items-center gap-3">
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama, NIS, kelas, atau mapel…" aria-label="Cari peserta"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20" />
            {tab === 'live' && <label className="inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} />Hanya yang perlu perhatian</label>}
        </div>}

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}

        {loading && !attempts.length ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat peserta ruang…</div>
            : tab === 'live' ? <ActiveParticipantsPanel key={slot.key} attempts={filtered} attentionOnly={attentionOnly}
                onFinish={canFinish ? finish : undefined}
                onViewDetails={attemptBasePath ? id => router.push(`${attemptBasePath}/${encodeURIComponent(id)}`) : undefined} />
            : tab === 'list' ? <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="overflow-x-auto" role="region" aria-label="Daftar peserta ruang" tabIndex={0}><table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] text-slate-500"><tr>{['Peserta', 'Kelas', 'Bank soal', 'Status', 'Peringatan'].map(label => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
                    <tbody>{[...filtered].sort((a, b) => String(a.profiles?.full_name || '').localeCompare(String(b.profiles?.full_name || ''), 'id')).map(attempt => {
                        const done = FINISHED.includes(attempt.status);
                        const active = attempt.status === 'in_progress';
                        return <tr key={`${attempt.exam_id}:${attempt.id}`} className="border-t border-slate-100">
                            <td className="px-4 py-2.5 font-medium text-slate-900">{formatStudentName(attempt.profiles?.full_name, 'Peserta')}<div className="text-[10px] font-normal text-slate-400">NIS {attempt.profiles?.identity_number || '—'}</div></td>
                            <td className="px-4 py-2.5 text-slate-600">{attempt.kelas_name || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600">{slot.exams.find(exam => exam.exam_id === attempt.exam_id)?.bank_title || '—'}</td>
                            <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${done ? 'bg-emerald-50 text-emerald-700' : active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{done ? 'Selesai' : active ? 'Mengerjakan' : 'Belum masuk'}</span></td>
                            <td className="px-4 py-2.5 tabular-nums text-slate-600">{attempt.warning_count || 0}</td>
                        </tr>;
                    })}</tbody>
                </table></div>
                {!filtered.length && <p className="px-4 py-10 text-center text-sm text-slate-500">Tidak ada peserta yang cocok.</p>}
            </div>
            : <MonitoringPASAdministrationPanel key={slot.key} exam={administrationExam} attempts={attempts} userRole={userRole} />}
    </section>;
}

/**
 * Monitoring ASAS/ASAT/AM per ruang × sesi × tanggal.
 * - Proktor/Admin: papan semua ruang dalam satu folder pada tanggal terpilih.
 * - Pengawas: langsung ke ruang yang sedang ia awasi; ruang tugas lain tetap bisa dipilih.
 */
export default function PASSlotMonitoring({ periodId, userRole, monitoringBasePath, attemptBasePath }: {
    periodId?: string;
    userRole: StaffRole;
    monitoringBasePath: string;
    attemptBasePath?: string;
}) {
    const { timeZone } = useSchoolTimeZone();
    const [dates, setDates] = useState<string[]>([]);
    const [date, setDate] = useState('');
    const [slots, setSlots] = useState<PASMonitoringSlot[]>([]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const autoSelected = useRef(false);
    const request = useRef(0);
    const invigilatorView = userRole === 'pengawas';

    const load = useCallback(async (targetDate: string, silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        setError(null);
        try {
            let result = await listPASMonitoringSlots({ date: targetDate || undefined, periodId });
            const nextDate = targetDate || pickSlotDate(result.available_dates, schoolTodayDate(timeZone));
            if (!targetDate && nextDate) result = await listPASMonitoringSlots({ date: nextDate, periodId });
            if (id !== request.current) return;
            setDates(result.available_dates);
            setDate(nextDate);
            setSlots(result.slots);
            setSelectedKey(previous => {
                if (previous && result.slots.some(slot => slot.key === previous)) return previous;
                if (invigilatorView && !autoSelected.current) {
                    autoSelected.current = true;
                    const nowTime = utcToSchoolLocalDateTime(new Date().toISOString(), timeZone).slice(11, 16);
                    return pickCurrentSlot(result.slots, nowTime)?.key || null;
                }
                return null;
            });
        } catch (loadError) {
            if (id === request.current) setError(loadError instanceof Error ? loadError.message : 'Monitoring ruang belum dapat dimuat.');
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, [periodId, timeZone, invigilatorView]);

    useEffect(() => { void load(''); }, [load]);
    useAutoRefresh(() => { if (date && !selectedKey) void load(date, true); }, REFRESH_INTERVAL.monitoring);

    const selected = slots.find(slot => slot.key === selectedKey) || null;
    const sessions = useMemo(() => {
        const groups = new Map<string, { label: string; slots: PASMonitoringSlot[] }>();
        for (const slot of slots) {
            const key = `${slot.period.id}:${slot.session.id}`;
            if (!groups.has(key)) groups.set(key, { label: `${slot.session.name} · ${hm(slot.session.start_time)}–${hm(slot.session.end_time)}${periodId ? '' : ` · ${slot.period.name}`}`, slots: [] });
            groups.get(key)!.slots.push(slot);
        }
        return [...groups.values()];
    }, [slots, periodId]);

    return <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
                <h2 className="text-sm font-bold text-slate-900">{invigilatorView ? 'Ruang yang Saya Awasi' : 'Pelaksanaan per Ruang'}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{invigilatorView
                    ? 'Semua siswa di ruang Anda tampil dalam satu daftar, apa pun kelas dan bank soalnya.'
                    : 'Pilih tanggal, lalu buka ruang untuk memantau seluruh siswanya sekaligus.'}</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Tanggal
                <select value={date} onChange={event => { setSelectedKey(null); void load(event.target.value); }} disabled={!dates.length || loading}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium">
                    {!dates.length && <option value="">Belum ada jadwal</option>}
                    {dates.map(item => <option key={item} value={item}>{formatSlotDate(item)}</option>)}
                </select>
            </label>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
            <button type="button" className="ml-auto font-semibold underline" onClick={() => void load(date)}>Coba lagi</button></div>}

        {selected ? <RoomMonitor key={selected.key} slot={selected} userRole={userRole} monitoringBasePath={monitoringBasePath}
            attemptBasePath={attemptBasePath} onBack={slots.length > 1 || !invigilatorView ? () => setSelectedKey(null) : undefined} />
            : loading ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat ruang ujian…</div>
            : !slots.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <Users size={28} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">{invigilatorView ? 'Tidak ada ruang yang Anda awasi pada tanggal ini' : 'Belum ada ruang terjadwal pada tanggal ini'}</p>
                <p className="mt-1 text-xs text-slate-500">{invigilatorView ? 'Monitoring ruang hanya terbuka pada hari tugas Anda. Hubungi Proktor bila jadwal hari ini belum muncul.' : 'Pastikan jadwal sudah diaktifkan dan siswa sudah ditempatkan di ruang.'}</p>
            </div>
            : <div className="space-y-5">{sessions.map(group => <section key={group.label} aria-label={group.label}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.slots.map(slot => <SlotCard key={slot.key} slot={slot} active={false} onSelect={() => setSelectedKey(slot.key)} />)}
                </div>
            </section>)}</div>}
    </div>;
}
