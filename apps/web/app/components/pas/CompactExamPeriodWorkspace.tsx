'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Lock, Settings2 } from 'lucide-react';
import type { PASClassSchedule, PASPeriod, PASSession } from '@/app/types/pas';
import type { PASRoom } from '@/lib/api/pas';
import { formatSchoolDate, getSchoolTimeZoneLabel } from '@/lib/school-time';
import { semesterAssessmentLabel } from '@/lib/exam-types';
import { Button } from '@/app/components/ui/button';
import { FilterActions, FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
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

export const COMPACT_PERIOD_TABS = [
    ['schedules', 'Jadwal'], ['rooms', 'Ruang dan Pengawas'], ['sessions', 'Sesi'], ['exam_settings', 'Pengaturan Ujian'], ['administration', 'Administrasi'],
] as const;

/** Kepala folder ASAS/AM: judul & aksi utama, kartu ringkasan 4 kolom, lalu satu baris tab. */
export function CompactExamPeriodHeader({ period, schedules, activeTab, onTabChange, formatDate, onSettings, onAddSchedule, onBulkSchedule }: HeaderProps) {
    const ready = schedules.filter(isPASScheduleReady).length;
    const active = schedules.filter(schedule => schedule.is_activated === true).length;
    const pending = schedules.length - ready;

    return <div className="compact-period-header">
        <header className="cp-heading">
            <div className="cp-title">
                <h1>{period.name}</h1>
                <div className="cp-context">
                    <span className="cp-type">{semesterAssessmentLabel(period.type, true)}</span>
                    <span>{formatDate(period.start_date)}–{formatDate(period.end_date)}</span>
                    <span>{period.school_year} · {period.semester === 'genap' ? 'Genap' : 'Ganjil'}</span>
                    {period.is_locked && <span className="cp-locked"><Lock size={12} aria-hidden="true" />Terkunci</span>}
                </div>
            </div>
            <div className="cp-heading-actions">
                <Button variant="outline" size="sm" disabled={period.is_locked} onClick={onSettings} leftIcon={<Settings2 size={15} />}>Pengaturan periode</Button>
                {!period.is_locked && <>
                    <Button variant="outline" size="sm" onClick={onBulkSchedule} leftIcon={<Layers size={15} />}>Jadwal massal</Button>
                    <Button icon="add" size="sm" onClick={onAddSchedule}>Tambah jadwal</Button>
                </>}
            </div>
        </header>
        <dl className="cp-summary-card" aria-label="Ringkasan jadwal ujian">
            {([
                ['Jadwal kelas', schedules.length, ''],
                ['Siap', ready, ready > 0 && ready === schedules.length ? 'is-good' : ''],
                ['Aktif', active, active > 0 ? 'is-active' : ''],
                ['Perlu dilengkapi', pending, pending > 0 ? 'is-warning' : ''],
            ] as const).map(([label, value, tone]) => <div key={label} className={tone || undefined}>
                <dt>{label}</dt><dd>{value}</dd>
            </div>)}
        </dl>
        <nav className="cp-tabs" aria-label="Bagian pengaturan ujian">
            {COMPACT_PERIOD_TABS.map(([id, label]) =>
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
/** Nilai kosong = "semua" (sama dengan tombol atur ulang filter di FilterToolbar). */
const ALL = '';

export function CompactExamPeriodSchedules({ period, classes, sessions, rooms, timeZone, today, bankTitle, busy, onActivation, onDelete, onManageRooms, monitoringBasePath }: SchedulesProps) {
    const [search, setSearch] = useState('');
    const [dateFilter, setDateFilter] = useState(ALL);
    const [classFilter, setClassFilter] = useState(ALL);
    const [readinessFilter, setReadinessFilter] = useState(ALL);
    const [accessFilter, setAccessFilter] = useState(ALL);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [detailId, setDetailId] = useState<string | null>(null);
    const schedules = period.pas_class_schedules || [];
    const roomNames = (schedule: PASClassSchedule) => (schedule.allocated_room_ids || []).map(id => rooms.find(room => room.id === id)?.name || 'Data ruang belum dimuat');
    /** Ruang tempat siswa kelas ini duduk, terbanyak dulu, beserta jumlah siswanya. */
    const roomAllocations = (schedule: PASClassSchedule) => (schedule.allocated_room_ids || [])
        .map(id => ({ id, name: rooms.find(room => room.id === id)?.name || 'Data ruang belum dimuat', count: schedule.allocated_room_counts?.[id] }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name, 'id'));
    const className = (schedule: PASClassSchedule) => schedule.classes?.name || classes.find(kelas => kelas.id === schedule.class_id)?.name || 'Kelas belum ditentukan';
    const dates = [...new Set(schedules.map(schedule => day(schedule.scheduled_date)).filter(Boolean))].sort();
    const query = search.trim().toLowerCase();
    const filtered = schedules.filter(schedule => {
        if (query && ![bankTitle(schedule.bank_id, schedule), className(schedule), schedule.subjects?.name, schedule.room, ...roomNames(schedule)].join(' ').toLowerCase().includes(query)) return false;
        if (dateFilter && day(schedule.scheduled_date) !== (dateFilter === 'today' ? today : dateFilter)) return false;
        if (classFilter && schedule.class_id !== classFilter) return false;
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

    const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); setSelectedIds([]); };
    const resetFilters = () => { setSearch(''); setDateFilter(ALL); setClassFilter(ALL); setReadinessFilter(ALL); setAccessFilter(ALL); setPage(1); setSelectedIds([]); };
    const changeActivation = async (ids: string[], active: boolean) => {
        const completed = await onActivation(ids, active);
        if (completed === true) setSelectedIds([]);
    };
    const manageRooms = () => { setDetailId(null); onManageRooms(); };
    const hasFilters = Boolean(search || dateFilter || classFilter || readinessFilter || accessFilter);
    const monitoringHref = (examId: string) => `${monitoringBasePath}?exam=${encodeURIComponent(examId)}`;

    return <section className="compact-period-schedules" aria-label="Jadwal ASAS dan AM">
        <FilterToolbar className="cp-toolbar">
            <FilterSearch value={search} onChange={value => changeFilter(setSearch, value)} placeholder="Cari bank soal, mapel, kelas, atau ruang…" grow={2} width="240px" />
            <FilterSelect label="Tanggal" icon="calendar3" value={dateFilter} onChange={value => changeFilter(setDateFilter, value)} width="160px"
                options={[{ value: ALL, label: 'Semua tanggal' }, { value: 'today', label: 'Hari ini' }, ...dates.map(date => ({ value: date, label: formatSchoolDate(date, timeZone) }))]} />
            <FilterSelect label="Kelas" icon="people" value={classFilter} onChange={value => changeFilter(setClassFilter, value)} width="130px"
                options={[{ value: ALL, label: 'Semua kelas' }, ...classOptions.map(kelas => ({ value: kelas.id, label: kelas.name }))]} />
            <FilterSelect label="Kesiapan" icon="check2-circle" value={readinessFilter} onChange={value => changeFilter(setReadinessFilter, value)} width="140px"
                options={[{ value: ALL, label: 'Semua kesiapan' }, { value: 'ready', label: 'Siap' }, { value: 'pending', label: 'Perlu dilengkapi' }]} />
            <FilterSelect label="Akses siswa" icon="unlock" value={accessFilter} onChange={value => changeFilter(setAccessFilter, value)} width="140px"
                options={[{ value: ALL, label: 'Semua akses' }, { value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }, { value: 'unknown', label: 'Belum diperiksa' }]} />
            {hasFilters && <FilterActions><Button variant="ghost" size="sm" onClick={resetFilters}>Hapus filter</Button></FilterActions>}
        </FilterToolbar>

        {chosen.length > 0 && <div className="cp-selection" role="group" aria-label="Tindakan jadwal terpilih">
            <span>{chosen.length} jadwal dipilih</span>
            <div className="cp-selection-actions">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelectedIds([])}>Batalkan pilihan</Button>
                {activeIds.length > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => void changeActivation(activeIds, false)}>Nonaktifkan ({activeIds.length})</Button>}
                {!period.is_locked && <Button variant="primary" size="sm" disabled={busy || !readyIds.length} onClick={() => void changeActivation(readyIds, true)}>Aktifkan ({readyIds.length})</Button>}
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
                        const allocations = roomAllocations(schedule);
                        const unallocated = schedule.unallocated_student_count || 0;
                        const title = bankTitle(schedule.bank_id, schedule);
                        const ready = isPASScheduleReady(schedule);
                        return <tr key={schedule.id} data-selected={selectedIds.includes(schedule.id)}>
                            <td><input type="checkbox" aria-label={`Pilih ${title} ${className(schedule)}`} checked={selectedIds.includes(schedule.id)} disabled={busy}
                                onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, schedule.id])] : ids.filter(id => id !== schedule.id))} /></td>
                            <td className="cp-bank"><strong>{title}</strong><span>{className(schedule)}</span></td>
                            <td className="cp-date"><span>{formatSchoolDate(schedule.scheduled_date, timeZone)}</span><small>{session?.name || 'Sesi belum ditentukan'} · {clock(session?.start_time || schedule.scheduled_time)}–{clock(session?.end_time || schedule.window_end_time)}</small></td>
                            <td>{allocations.length ? <button type="button" className="cp-room cp-room-list" onClick={() => setDetailId(schedule.id)}
                                aria-label={`Ruang ${className(schedule)}: ${allocations.map(room => room.count != null ? `${room.name} ${room.count} siswa` : room.name).join(', ')}`}>
                                {allocations.slice(0, 3).map(room => <span key={room.id} className="cp-room-line">
                                    <span className="cp-room-name">{room.name}</span>{room.count != null && <span className="cp-room-count">({room.count})</span>}
                                </span>)}
                                {allocations.length > 3 && <span className="cp-room-more">+{allocations.length - 3} ruang lainnya</span>}
                            </button> : <button type="button" className="cp-room" onClick={() => setDetailId(schedule.id)}>{schedule.room || 'Belum diatur'}</button>}
                            {!allocations.length ? <small className="cp-room-pending">Penempatan belum diatur</small>
                                : unallocated > 0 && <small className="cp-room-pending">{unallocated} siswa belum dapat ruang</small>}</td>
                            <td>{ready ? <span className="cp-ready">Siap</span> : <button type="button" className="cp-warning" onClick={() => setDetailId(schedule.id)}>Perlu dilengkapi</button>}</td>
                            <td><span className={`cp-access ${schedule.is_activated === true ? 'is-active' : ''}`}>{access(schedule)}</span>{lifecycle(schedule) && <small className="cp-lifecycle">{lifecycle(schedule)}</small>}</td>
                            <td><div className="cp-row-actions">
                                <Button variant="ghost" size="sm" aria-label={`Detail ${title} ${className(schedule)}`} onClick={() => setDetailId(schedule.id)}>Detail</Button>
                                <PASScheduleActions compact active={schedule.is_activated} busy={busy}
                                    canActivate={!period.is_locked && schedule.is_activated === false && ready} canDelete={!period.is_locked}
                                    monitoringHref={schedule.exam_id ? monitoringHref(schedule.exam_id) : undefined}
                                    onActivate={() => void changeActivation([schedule.id], schedule.is_activated !== true)} onDelete={() => onDelete(schedule.id)} />
                            </div></td>
                        </tr>;
                    })}</tbody>
                </table>
            </div>
            {!visible.length && schedules.length > 0 && <div className="cp-empty">
                <p>Tidak ada jadwal yang sesuai.</p>
                {hasFilters && <div className="cp-empty-actions">
                    <Button variant="ghost" size="sm" onClick={resetFilters}>Hapus filter</Button>
                </div>}
            </div>}
            <div className="cp-footer">
                <span role="status">{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} dari ${filtered.length} jadwal` : '0 jadwal'}</span>
                {pages > 1 ? <nav aria-label="Halaman jadwal" className="cp-pagination">
                    <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Halaman sebelumnya" leftIcon={<ChevronLeft size={15} />} />
                    <span>{currentPage} / {pages}</span>
                    <Button variant="outline" size="sm" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Halaman berikutnya" leftIcon={<ChevronRight size={15} />} />
                </nav> : <span>Waktu sekolah · {timeZoneLabel}</span>}
            </div>
        </div>

        <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} size="md" labelledBy="cp-schedule-detail"
            title="Detail jadwal" subtitle={detail ? className(detail) : undefined}>
            <ModalBody className="cp-detail-body">
                {detail ? <>
                    <h3>{bankTitle(detail.bank_id, detail)}</h3>
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
                </> : <p>Jadwal tidak lagi tersedia. Tutup panel untuk melihat daftar terbaru.</p>}
            </ModalBody>
            <ModalFooter>
                <Button variant="ghost" onClick={() => setDetailId(null)}>Tutup</Button>
                {detail && !period.is_locked && <Button variant="outline" onClick={manageRooms}>Atur ruang & pengawas</Button>}
                {detail?.exam_id && <a className="ui-btn ui-btn--primary ui-btn--md" href={monitoringHref(detail.exam_id)}><span className="ui-btn__label">Buka monitoring</span></a>}
            </ModalFooter>
        </Modal>
    </section>;
}
