'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Clock, DoorOpen, Loader2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { ParticipantsWorkspace, WorkspaceError, type WorkspaceSection } from '@/app/components/monitoring/ParticipantsWorkspace';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import { listPASMonitoringSlots, type PASMonitoringSlot } from '@/lib/api/pas';
import { getExamAttemptsAction, listOrganizationExams, type ExamAttemptRecord, type OrganizationExam } from '@/lib/api/proctor';
import { schoolTodayDate, utcToSchoolLocalDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import './monitoring.css';

type StaffRole = 'admin' | 'proktor' | 'pengawas';

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
export const formatSlotDate = (date: string) => isDay(date)
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : date;
const hm = (value: string) => String(value || '').slice(0, 5);

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

function SlotRow({ slot, onSelect }: { slot: PASMonitoringSlot; onSelect: () => void }) {
    const { in_progress: running, finished, not_started: waiting } = slot.counts;
    const classes = [...new Set(slot.exams.flatMap(exam => exam.class_name.split(', ')))].join(', ');
    return <tr>
        <td><div className="monitoring-room-name"><DoorOpen size={15} aria-hidden="true" />
            <button type="button" onClick={onSelect}>{slot.room.name}</button>
            {slot.is_mine && <span className="monitoring-room-assignment">Tugas saya</span>}
        </div></td>
        <td>{classes || '—'}</td>
        <td className="monitoring-room-count monitoring-room-count--running">{running}</td>
        <td className="monitoring-room-count monitoring-room-count--finished">{finished}</td>
        <td className="monitoring-room-count">{waiting}</td>
        <td>{slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : <span className="text-amber-700">Pengawas belum diatur</span>}</td>
        <td><button type="button" className="monitoring-room-open" onClick={onSelect} aria-label={`Buka ruang ${slot.room.name}`}>Buka ruang</button></td>
    </tr>;
}

/** Bagian monitoring ruang: Hasil hanya untuk Admin/Proktor; reset & pengecualian layar ada di menu Tindakan. */
export function roomSections(userRole: StaffRole): WorkspaceSection[] {
    return userRole === 'pengawas' ? ['peserta', 'jawaban', 'berita'] : ['peserta', 'jawaban', 'hasil', 'berita'];
}

/** Satu entri per ujian: ujian gabungan (satu bank soal, beberapa kelas) diringkas menjadi satu. */
export function mergeSlotExams(exams: PASMonitoringSlot['exams']): PASMonitoringSlot['exams'] {
    const byExam = new Map<string, PASMonitoringSlot['exams'][number]>();
    for (const exam of exams) {
        const current = byExam.get(exam.exam_id);
        if (!current) { byExam.set(exam.exam_id, { ...exam }); continue; }
        const classes = new Set([...current.class_name.split(', '), exam.class_name]);
        current.class_name = [...classes].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })).join(', ');
        current.student_count += exam.student_count;
    }
    return [...byExam.values()];
}

function RoomMonitor({ slot, userRole, attemptBasePath, onBack, trailing }: {
    slot: PASMonitoringSlot; userRole: StaffRole; attemptBasePath?: string; onBack?: () => void; trailing?: ReactNode;
}) {
    // Ujian gabungan per bank soal muncul sekali, walau dipakai beberapa kelas di ruang ini.
    const roomExams = useMemo(() => mergeSlotExams(slot.exams), [slot.exams]);
    const [attemptsByExam, setAttemptsByExam] = useState<Record<string, ExamAttemptRecord[]>>({});
    const [examRecords, setExamRecords] = useState<Record<string, OrganizationExam>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const request = useRef(0);

    const load = useCallback(async (silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        setError(null);
        const results = await Promise.allSettled(roomExams.map(exam => getExamAttemptsAction(exam.exam_id)));
        if (id !== request.current) return;
        const next: Record<string, ExamAttemptRecord[]> = {};
        const failures: string[] = [];
        results.forEach((result, index) => {
            const exam = roomExams[index];
            if (result.status === 'fulfilled') next[exam.exam_id] = result.value;
            else failures.push(`${exam.bank_title} (${exam.class_name})`);
        });
        setAttemptsByExam(next);
        if (failures.length) setError(`Peserta ujian ${failures.join(', ')} belum dapat dimuat.`);
        setLoading(false);
    }, [roomExams]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(false), 0);
        return () => window.clearTimeout(timer);
    }, [load]);
    useAutoRefresh(() => void load(true), REFRESH_INTERVAL.monitoring);

    // Hak akses per ujian (reset, kelola, koreksi kunci) dan pengaturannya, sama dengan monitoring ujian biasa.
    useEffect(() => {
        let active = true;
        const ids = new Set(roomExams.map(exam => exam.exam_id));
        listOrganizationExams()
            .then(list => { if (active) setExamRecords(Object.fromEntries(list.filter(exam => ids.has(exam.id)).map(exam => [exam.id, exam]))); })
            .catch(() => { /* Tanpa data ujian, aksi yang butuh izin tetap tersembunyi. */ });
        return () => { active = false; };
    }, [roomExams]);

    const attempts = useMemo(() => slotAttempts(slot, attemptsByExam), [slot, attemptsByExam]);
    const examOptions = useMemo(() => roomExams.map(exam => ({ exam_id: exam.exam_id, label: `${exam.bank_title} · ${exam.class_name}` })), [roomExams]);
    const administrationExam = {
        id: roomExams[0]?.exam_id, exam_type: slot.period.type, title: slot.period.name,
        metadata: { pas_period_id: slot.period.id, pas_schedule_id: roomExams[0]?.schedule_id },
    } as unknown as OrganizationExam;

    return <section className="space-y-4" aria-label={`Monitoring ${slot.room.name} ${slot.session.name}`}>
        <div className="space-y-2">
            {onBack && <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><ArrowLeft size={13} />Semua ruang</button>}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-base font-bold text-slate-900">{slot.room.name} · {slot.session.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                        <Clock size={12} className="mr-1 inline" />{formatSlotDate(slot.date)} · {hm(slot.session.start_time)}–{hm(slot.session.end_time)}
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        <ShieldCheck size={12} className="mr-1 inline" />{slot.invigilators.length ? slot.invigilators.map(person => person.full_name).join(', ') : 'Pengawas belum diatur'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{examOptions.map(option => option.label).join(' · ')}</p>
                </div>
                <button type="button" onClick={() => void load(false)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Perbarui data ruang">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Perbarui
                </button>
            </div>
        </div>

        {error && <WorkspaceError text={error} onRetry={() => void load(false)} />}

        <ParticipantsWorkspace
            attempts={attempts}
            examOptions={examOptions}
            examRecords={examRecords}
            userRole={userRole}
            sections={roomSections(userRole)}
            loading={loading}
            attemptBasePath={attemptBasePath}
            onReload={() => load(true)}
            exportTitle={slot.period.name}
            trailing={trailing}
            administration={<MonitoringPASAdministrationPanel key={slot.key} exam={administrationExam} attempts={attempts} userRole={userRole} />}
        />
    </section>;
}

/**
 * Monitoring ASAS/ASAT/AM per ruang × sesi × tanggal.
 * - Proktor/Admin: papan semua ruang dalam satu folder pada tanggal terpilih.
 * - Pengawas: langsung ke ruang yang sedang ia awasi; ruang tugas lain tetap bisa dipilih.
 */
export default function PASSlotMonitoring({ periodId, userRole, attemptBasePath, embedded = false, trailing }: {
    periodId?: string;
    userRole: StaffRole;
    /** Tidak dipakai lagi; dipertahankan agar pemanggil lama tetap valid. */
    monitoringBasePath?: string;
    attemptBasePath?: string;
    /** Di dalam halaman Monitoring: tanpa judul kartu, cukup baris pilihan tanggal. */
    embedded?: boolean;
    /** Kontrol di ujung kanan (papan ruang: baris tanggal; isi ruang: baris tab). */
    trailing?: ReactNode;
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

    useEffect(() => {
        const timer = window.setTimeout(() => void load(''), 0);
        return () => window.clearTimeout(timer);
    }, [load]);
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
        {(!embedded || !selected) && <div className="flex flex-wrap items-center justify-between gap-3">
            {!embedded && <div>
                <h2 className="text-sm font-bold text-slate-900">{invigilatorView ? 'Ruang yang Saya Awasi' : 'Pelaksanaan per Ruang'}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{invigilatorView
                    ? 'Semua siswa di ruang Anda tampil dalam satu daftar, apa pun kelas dan bank soalnya.'
                    : 'Pilih tanggal, lalu buka ruang untuk memantau seluruh siswanya sekaligus.'}</p>
            </div>}
            {!selected && <label className={`flex items-center gap-2 text-xs font-medium text-slate-600 ${embedded ? '' : 'ml-auto'}`}>Tanggal
                <InlineSelect value={date} onChange={value => { setSelectedKey(null); void load(value); }} disabled={!dates.length || loading} minWidth="220px" aria-label="Tanggal ujian"
                    options={dates.length ? dates.map(item => ({ value: item, label: formatSlotDate(item) })) : [{ value: '', label: 'Belum ada jadwal' }]} />
            </label>}
            {!selected && trailing && <div className="ml-auto">{trailing}</div>}
        </div>}

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
            <button type="button" className="ml-auto font-semibold underline" onClick={() => void load(date)}>Coba lagi</button></div>}

        {selected ? <RoomMonitor key={selected.key} slot={selected} userRole={userRole} trailing={trailing}
            attemptBasePath={attemptBasePath} onBack={slots.length > 1 || !invigilatorView ? () => setSelectedKey(null) : undefined} />
            : loading ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat ruang ujian…</div>
            : !slots.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <Users size={28} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">{invigilatorView ? 'Tidak ada ruang yang Anda awasi pada tanggal ini' : 'Belum ada ruang terjadwal pada tanggal ini'}</p>
                <p className="mt-1 text-xs text-slate-500">{invigilatorView ? 'Monitoring ruang hanya terbuka pada hari tugas Anda. Hubungi Proktor bila jadwal hari ini belum muncul.' : 'Pastikan jadwal sudah diaktifkan dan siswa sudah ditempatkan di ruang.'}</p>
            </div>
            : <div className="space-y-5">{sessions.map(group => <section key={group.label} aria-label={group.label}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</h3>
                <div className="monitoring-room-table-wrap" role="region" aria-label={`Daftar ruang ${group.label}`} tabIndex={0}>
                    <table className="monitoring-room-table">
                        <thead><tr>
                            <th scope="col">Ruang</th><th scope="col">Kelas</th>
                            <th scope="col" className="monitoring-room-count">Mengerjakan</th>
                            <th scope="col" className="monitoring-room-count">Selesai</th>
                            <th scope="col" className="monitoring-room-count">Belum masuk</th>
                            <th scope="col">Pengawas</th><th scope="col"><span className="sr-only">Tindakan</span></th>
                        </tr></thead>
                        <tbody>{group.slots.map(slot => <SlotRow key={slot.key} slot={slot} onSelect={() => setSelectedKey(slot.key)} />)}</tbody>
                    </table>
                </div>
            </section>)}</div>}
    </div>;
}
