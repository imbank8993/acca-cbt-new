'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Search, X } from 'lucide-react';
import type { PASClassSchedule, PASPeriod, PASSession } from '@/app/types/pas';
import type { PASRoom } from '@/lib/api/pas';
import { formatSchoolDate, getSchoolTimeZoneLabel } from '@/lib/school-time';
import { isPASScheduleReady } from '../PASScheduleStatus';
import { PASScheduleRooms } from '../PASScheduleRooms';
import { PASScheduleActions } from '../PASScheduleActions';
import './compact-exam-period.css';

interface HeaderProps {
    period: PASPeriod;
    schedules: PASClassSchedule[];
    activeTab: string;
    onTabChange: (tab: string) => void;
    formatDate: (value: string) => string;
    onSettings: () => void;
    onAddSchedule: () => void;
    onBulkSchedule: () => void;
}

export function CompactExamPeriodHeader({ period, schedules, activeTab, onTabChange, formatDate, onSettings, onAddSchedule, onBulkSchedule }: HeaderProps) {
    const addRef = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const outside = (event: PointerEvent) => {
            if (addRef.current && !addRef.current.contains(event.target as Node)) addRef.current.open = false;
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, []);
    const stats = [
        ['Jadwal kelas', schedules.length],
        ['Siap', schedules.filter(isPASScheduleReady).length],
        ['Aktif', schedules.filter(schedule => schedule.is_activated === true).length],
        ['Perlu dilengkapi', schedules.filter(schedule => !isPASScheduleReady(schedule)).length],
    ] as const;
    const add = (action: () => void) => { if (addRef.current) addRef.current.open = false; action(); };

    return <div className="compact-period-header">
        <header className="cp-heading">
            <div className="cp-title">
                <h1>{period.name}</h1>
                <div className="cp-context">
                    <span className="cp-type">{period.type === 'am' ? 'AM' : 'ASAS / PAS'}</span>
                    <span>{formatDate(period.start_date)}–{formatDate(period.end_date)}</span>
                    <span>{period.school_year} · {period.semester === 'genap' ? 'Genap' : 'Ganjil'}</span>
                    {period.is_locked && <span className="cp-locked"><Lock size={12} aria-hidden="true" />Terkunci</span>}
                </div>
            </div>
            <div className="cp-heading-actions">
                <button type="button" className="cp-control" disabled={period.is_locked} onClick={onSettings}>Pengaturan periode</button>
                {!period.is_locked && <details ref={addRef} className="cp-add" onKeyDown={event => {
                    if (event.key === 'Escape' && addRef.current) { addRef.current.open = false; addRef.current.querySelector('summary')?.focus(); }
                }}>
                    <summary className="cp-control cp-primary">+ Tambah jadwal<ChevronDown size={14} aria-hidden="true" /></summary>
                    <div className="cp-add-menu">
                        <button type="button" onClick={() => add(onAddSchedule)}>Satu jadwal</button>
                        <button type="button" onClick={() => add(onBulkSchedule)}>Jadwal massal</button>
                    </div>
                </details>}
            </div>
        </header>
        <dl className="cp-summary" aria-label="Ringkasan jadwal ujian">
            {stats.map(([label, value], index) => <div key={label} className={index === 3 && value > 0 ? 'cp-summary-warning' : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <nav className="cp-tabs" aria-label="Bagian pengaturan ujian">
            {[['schedules', 'Jadwal'], ['rooms_sessions', 'Ruang & Sesi'], ['administration', 'Administrasi']].map(([id, label]) =>
                <button key={id} type="button" aria-pressed={activeTab === id || (id === 'schedules' && activeTab === 'bulk')} onClick={() => onTabChange(id)}>{label}</button>)}
        </nav>
    </div>;
}

interface SchedulesProps {
    period: PASPeriod;
    classes: { id: string; name: string }[];
    sessions: PASSession[];
    rooms: PASRoom[];
    timeZone: string;
    today: string;
    bankTitle: (bankId: string | null, schedule?: PASClassSchedule) => string;
    busy: boolean;
    onActivation: (ids: string[], active: boolean) => void | boolean | Promise<void | boolean>;
    onDelete: (id: string) => void;
    onManageRooms: () => void;
    monitoringBasePath: string;
    onAddSchedule: () => void;
    onBulkSchedule: () => void;
}

const day = (value: string) => value?.split('T')[0] || '';
const clock = (value?: string | null) => value ? (value.includes('T') ? value.split('T')[1] : value).slice(0, 5) : '—';
const lifecycle = (schedule: PASClassSchedule) => ({ active: 'Sedang ujian', finished: 'Selesai', cancelled: 'Dibatalkan', scheduled: '' }[schedule.status] || '');
const access = (schedule: PASClassSchedule) => schedule.is_activated === true ? 'Aktif' : schedule.is_activated === false ? 'Nonaktif' : 'Belum diperiksa';
const PAGE_SIZE = 25;

export function CompactExamPeriodSchedules({ period, classes, sessions, rooms, timeZone, today, bankTitle, busy, onActivation, onDelete, onManageRooms, monitoringBasePath, onAddSchedule, onBulkSchedule }: SchedulesProps) {
    const [search, setSearch] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [readinessFilter, setReadinessFilter] = useState('all');
    const [accessFilter, setAccessFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [detailId, setDetailId] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const dialogTitle = useId();
    const schedules = period.pas_class_schedules || [];
    const roomNames = (schedule: PASClassSchedule) => (schedule.allocated_room_ids || []).map(id => rooms.find(room => room.id === id)?.name || 'Data ruang belum dimuat');
    const className = (schedule: PASClassSchedule) => schedule.classes?.name || classes.find(kelas => kelas.id === schedule.class_id)?.name || 'Kelas belum ditentukan';
    const dates = [...new Set(schedules.map(schedule => day(schedule.scheduled_date)).filter(Boolean))].sort();
    const query = search.trim().toLowerCase();
    const filtered = schedules.filter(schedule => {
        if (query && ![bankTitle(schedule.bank_id, schedule), className(schedule), schedule.subjects?.name, schedule.room, ...roomNames(schedule)].join(' ').toLowerCase().includes(query)) return false;
        if (dateFilter !== 'all' && day(schedule.scheduled_date) !== (dateFilter === 'today' ? today : dateFilter)) return false;
        if (classFilter !== 'all' && schedule.class_id !== classFilter) return false;
        if (readinessFilter === 'ready' && !isPASScheduleReady(schedule)) return false;
        if (readinessFilter === 'pending' && isPASScheduleReady(schedule)) return false;
        if (accessFilter === 'active' && schedule.is_activated !== true) return false;
        if (accessFilter === 'inactive' && schedule.is_activated !== false) return false;
        if (accessFilter === 'unknown' && schedule.is_activated != null) return false;
        return true;
    }).sort((a, b) => day(a.scheduled_date).localeCompare(day(b.scheduled_date))
        || (sessions.find(session => session.id === a.session_id)?.start_time || a.scheduled_time || '').localeCompare(sessions.find(session => session.id === b.session_id)?.start_time || b.scheduled_time || '')
        || bankTitle(a.bank_id, a).localeCompare(bankTitle(b.bank_id, b), 'id')
        || className(a).localeCompare(className(b), 'id', { numeric: true }) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, pages);
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const chosen = schedules.filter(schedule => selectedIds.includes(schedule.id));
    const readyIds = chosen.filter(schedule => !period.is_locked && schedule.is_activated === false && isPASScheduleReady(schedule)).map(schedule => schedule.id);
    const activeIds = chosen.filter(schedule => schedule.is_activated === true).map(schedule => schedule.id);
    const allVisibleSelected = visible.length > 0 && visible.every(schedule => selectedIds.includes(schedule.id));
    const someVisibleSelected = visible.some(schedule => selectedIds.includes(schedule.id));
    const detail = schedules.find(schedule => schedule.id === detailId);
    const detailSession = sessions.find(session => session.id === detail?.session_id);
    const issues = detail?.readiness?.issues?.length ? detail.readiness.issues : detail && !isPASScheduleReady(detail) ? ['Kelengkapan belum dapat dipastikan. Muat ulang daftar.'] : [];
    const timeZoneLabel = getSchoolTimeZoneLabel(timeZone);
    const filteredClassIds = new Set(schedules.map(schedule => schedule.class_id));
    const classOptions = [...new Map([...classes, ...schedules.filter(schedule => schedule.classes).map(schedule => schedule.classes!)].filter(kelas => filteredClassIds.has(kelas.id)).map(kelas => [kelas.id, kelas])).values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));

    useEffect(() => {
        const dialog = dialogRef.current;
        if (detailId && dialog && !dialog.open) dialog.showModal();
        if (!detailId && dialog?.open) dialog.close();
    }, [detailId]);

    const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); setSelectedIds([]); };
    const resetFilters = () => { setSearch(''); setDateFilter('all'); setClassFilter('all'); setReadinessFilter('all'); setAccessFilter('all'); setPage(1); setSelectedIds([]); };
    const changeActivation = async (ids: string[], active: boolean) => {
        const completed = await onActivation(ids, active);
        if (completed === true) setSelectedIds([]);
    };
    const manageRooms = () => { setDetailId(null); onManageRooms(); };
    const hasFilters = Boolean(search || dateFilter !== 'all' || classFilter !== 'all' || readinessFilter !== 'all' || accessFilter !== 'all');

    return <section className="compact-period-schedules" aria-label="Jadwal ASAS dan AM">
        <div className="cp-filters" role="group" aria-label="Filter jadwal">
            <label className="cp-search"><span className="sr-only">Cari jadwal</span><Search size={15} aria-hidden="true" /><input type="search" value={search} onChange={event => changeFilter(setSearch, event.target.value)} placeholder="Cari bank soal, mapel, kelas, atau ruang…" /></label>
            <select className="cp-control" aria-label="Filter tanggal" value={dateFilter} onChange={event => changeFilter(setDateFilter, event.target.value)}>
                <option value="all">Semua tanggal</option><option value="today">Hari ini</option>{dates.map(date => <option key={date} value={date}>{formatSchoolDate(date, timeZone)}</option>)}
            </select>
            <select className="cp-control" aria-label="Filter kelas" value={classFilter} onChange={event => changeFilter(setClassFilter, event.target.value)}>
                <option value="all">Semua kelas</option>{classOptions.map(kelas => <option key={kelas.id} value={kelas.id}>{kelas.name}</option>)}
            </select>
            <select className="cp-control" aria-label="Filter kesiapan" value={readinessFilter} onChange={event => changeFilter(setReadinessFilter, event.target.value)}>
                <option value="all">Semua kesiapan</option><option value="ready">Siap</option><option value="pending">Perlu dilengkapi</option>
            </select>
            <select className="cp-control" aria-label="Filter akses siswa" value={accessFilter} onChange={event => changeFilter(setAccessFilter, event.target.value)}>
                <option value="all">Semua akses</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option><option value="unknown">Belum diperiksa</option>
            </select>
            {hasFilters && <button type="button" className="cp-link" onClick={resetFilters}>Hapus filter</button>}
        </div>
        {chosen.length > 0 && <div className="cp-selection" role="group" aria-label="Tindakan jadwal terpilih">
            <span>{chosen.length} jadwal dipilih</span><div className="cp-selection-actions">
                <button type="button" className="cp-link" disabled={busy} onClick={() => setSelectedIds([])}>Batalkan pilihan</button>
                {activeIds.length > 0 && <button type="button" className="cp-control" disabled={busy} onClick={() => void changeActivation(activeIds, false)}>Nonaktifkan ({activeIds.length})</button>}
                {!period.is_locked && <button type="button" className="cp-control" disabled={busy || !readyIds.length} onClick={() => void changeActivation(readyIds, true)}>Aktifkan ({readyIds.length})</button>}
            </div>
        </div>}
        <div className="cp-table-surface">
            <div className="cp-table-scroll" role="region" aria-label="Tabel jadwal, geser untuk melihat seluruh kolom" tabIndex={0}>
                <table className="cp-table">
                    <thead><tr><th><input type="checkbox" aria-label="Pilih semua jadwal di halaman ini" checked={allVisibleSelected} disabled={busy || !visible.length}
                        ref={input => { if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                        onChange={() => setSelectedIds(ids => allVisibleSelected ? ids.filter(id => !visible.some(schedule => schedule.id === id)) : [...new Set([...ids, ...visible.map(schedule => schedule.id)])])} /></th>
                        {['Bank soal / kelas', 'Tanggal & sesi', 'Ruang', 'Kesiapan', 'Akses', ''].map((label, index) => <th key={index} scope="col">{label || <span className="sr-only">Tindakan</span>}</th>)}
                    </tr></thead>
                    <tbody>{visible.map(schedule => {
                        const session = sessions.find(item => item.id === schedule.session_id);
                        const names = roomNames(schedule);
                        const title = bankTitle(schedule.bank_id, schedule);
                        const ready = isPASScheduleReady(schedule);
                        return <tr key={schedule.id} data-selected={selectedIds.includes(schedule.id)}>
                            <td><input type="checkbox" aria-label={`Pilih ${title} ${className(schedule)}`} checked={selectedIds.includes(schedule.id)} disabled={busy}
                                onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, schedule.id])] : ids.filter(id => id !== schedule.id))} /></td>
                            <td className="cp-bank"><strong>{title}</strong><span>{className(schedule)}</span></td>
                            <td className="cp-date"><span>{formatSchoolDate(schedule.scheduled_date, timeZone)}</span><small>{session?.name || 'Sesi belum ditentukan'} · {clock(session?.start_time || schedule.scheduled_time)}–{clock(session?.end_time || schedule.window_end_time)}</small></td>
                            <td><button type="button" className="cp-room" onClick={() => setDetailId(schedule.id)}>{names.length > 1 ? `${names.length} ruang` : names[0] || schedule.room || 'Belum diatur'}</button>{!names.length && <small className="cp-room-pending">Penempatan belum diatur</small>}</td>
                            <td>{ready ? <span className="cp-ready">Siap</span> : <button type="button" className="cp-warning" onClick={() => setDetailId(schedule.id)}>Perlu dilengkapi</button>}</td>
                            <td><span className={`cp-access ${schedule.is_activated === true ? 'is-active' : ''}`}>{access(schedule)}</span>{lifecycle(schedule) && <small className="cp-lifecycle">{lifecycle(schedule)}</small>}</td>
                            <td><div className="cp-row-actions"><button type="button" className="cp-link" aria-label={`Detail ${title} ${className(schedule)}`} onClick={() => setDetailId(schedule.id)}>Detail</button>
                                <PASScheduleActions compact active={schedule.is_activated} busy={busy}
                                    canActivate={!period.is_locked && schedule.is_activated === false && ready} canDelete={!period.is_locked}
                                    monitoringHref={schedule.exam_id ? `${monitoringBasePath}?exam=${encodeURIComponent(schedule.exam_id)}` : undefined}
                                    onActivate={() => void changeActivation([schedule.id], schedule.is_activated !== true)} onDelete={() => onDelete(schedule.id)} />
                            </div></td>
                        </tr>;
                    })}</tbody>
                </table>
            </div>
            {!visible.length && <div className="cp-empty"><p>{schedules.length ? 'Tidak ada jadwal yang sesuai.' : 'Belum ada jadwal ujian.'}</p>
                {hasFilters ? <button type="button" className="cp-link" onClick={resetFilters}>Hapus filter</button> : !period.is_locked && <div className="cp-empty-actions"><button type="button" className="cp-control" onClick={onAddSchedule}>Tambah jadwal</button><button type="button" className="cp-link" onClick={onBulkSchedule}>Jadwal massal</button></div>}
            </div>}
            <div className="cp-footer"><span role="status">{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} dari ${filtered.length} jadwal` : '0 jadwal'}</span>
                {pages > 1 ? <nav aria-label="Halaman jadwal" className="cp-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16} /></button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Halaman berikutnya"><ChevronRight size={16} /></button></nav> : <span>Waktu sekolah · {timeZoneLabel}</span>}
            </div>
        </div>
        <dialog ref={dialogRef} className="cp-detail-dialog" aria-labelledby={dialogTitle} onCancel={() => setDetailId(null)} onClose={() => setDetailId(null)}>
            <div className="cp-detail-header"><h2 id={dialogTitle}>Detail jadwal</h2><button type="button" onClick={() => setDetailId(null)} aria-label="Tutup detail jadwal"><X size={18} /></button></div>
            {detail ? <div className="cp-detail-body">
                <h3>{bankTitle(detail.bank_id, detail)}</h3><p className="cp-detail-class">{className(detail)}</p>
                {issues.length > 0 && <div className="cp-detail-issues"><h4>Perlu dilengkapi</h4><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
                <dl className="cp-detail-grid">
                    {[
                        ['Tanggal', formatSchoolDate(detail.scheduled_date, timeZone)], ['Sesi', detailSession?.name || 'Belum ditentukan'],
                        ['Waktu', `${clock(detailSession?.start_time || detail.scheduled_time)}–${clock(detailSession?.end_time || detail.window_end_time)} ${timeZoneLabel}`],
                        ['Durasi', detail.duration_minutes ? `${detail.duration_minutes} menit` : 'Belum ditentukan'],
                        ['Kesiapan', isPASScheduleReady(detail) ? 'Siap' : 'Perlu dilengkapi'], ['Akses siswa', access(detail)],
                    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <section className="cp-detail-rooms"><h4>Ruang & pengawas</h4><PASScheduleRooms schedule={detail} rooms={rooms} onManage={manageRooms} /></section>
                <div className="cp-detail-actions">{!period.is_locked && <button type="button" className="cp-control" onClick={manageRooms}>Atur ruang & pengawas</button>}
                    {detail.exam_id && <a className="cp-control" href={`${monitoringBasePath}?exam=${encodeURIComponent(detail.exam_id)}`}>Buka monitoring</a>}
                </div>
            </div> : <p className="cp-detail-body">Jadwal tidak lagi tersedia. Tutup panel untuk melihat daftar terbaru.</p>}
        </dialog>
    </section>;
}
