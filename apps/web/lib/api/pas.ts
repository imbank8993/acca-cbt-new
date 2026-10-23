import type { PASPeriod,PASSession } from '@/app/types/pas';
import type { OrganizationClass } from './proctor';
import { apiCreate,apiGet,apiSend } from './client';

export interface PASSubjectSummary {
    id: string;
    name: string;
    code?: string | null;
}

export interface PASStaffMember {
    id: string;
    name: string;
    roles: string[];
}

export interface PASRoomMember {
    user_id: string;
    session_id?: string | null;
    /** Tanggal tugas pengawas (YYYY-MM-DD); pengawas bergilir setiap hari. */
    exam_date?: string | null;
    profiles?: {
        full_name?: string | null;
    } | null;
}

export interface PASRoom {
    id: string;
    pas_period_id?: string;
    name: string;
    capacity: number;
    pas_room_invigilators?: PASRoomMember[];
    pas_room_students?: PASRoomMember[];
}

/** Normalisasi tanggal dari API (YYYY-MM-DD atau ISO) ke YYYY-MM-DD. */
export function pasDay(value?: string | null): string {
    return String(value || '').slice(0, 10);
}

/** Pengawas sebuah ruang pada satu sesi dan tanggal (pengawas bergilir per hari). */
export function getRoomSessionInvigilators(
    room: Pick<PASRoom, 'pas_room_invigilators'> | null | undefined,
    sessionId?: string | null,
    examDate?: string | null,
): PASRoomMember[] {
    const date = pasDay(examDate);
    if (!sessionId || !date) return [];
    return (room?.pas_room_invigilators || [])
        .filter(member => member.session_id === sessionId && pasDay(member.exam_date) === date);
}

export interface MasterRoom {
    id: string;
    name: string;
    code: string | null;
    location: string | null;
    capacity: number | null;
}

export async function listMasterRooms(): Promise<MasterRoom[]> {
    const res = await apiGet<{ rooms: MasterRoom[] }>('/api/pas/master-rooms');
    if (!res.success) throw new Error(res.error || 'Master ruang belum dapat dimuat.');
    return res.rooms;
}

/**
 * Penilaian Akhir Semester / Tahun (PAS/PAT).
 * Menggantikan `app/actions/pas.ts`.
 *
 * Bentuk nilai kembalinya dipertahankan seperti server action lama (`[]` /
 * `null` saat gagal, `{ success, error }` untuk mutasi) supaya halaman PAS tidak
 * perlu mengubah penanganan galatnya.
 *
 * `userId` tidak lagi dikirim saat membuat periode — identitas pembuat diambil
 * NestJS dari token.
 *
 * Sembilan aksi dari berkas lama tidak punya penggantinya di sini karena tidak
 * punya pemanggil: statistik dasbor, ubah periode, ubah jadwal, dan seluruh
 * pengelolaan mapel PAS. Alasan lengkapnya ada di `apps/api/src/pas/pas.service.ts`.
 */

// ── Periode ──────────────────────────────────────────────────────────────────

export async function listPASPeriods(): Promise<PASPeriod[]> {
    const res = await apiGet<{ periods: PASPeriod[] }>('/api/pas/periods');
    return res.success ? res.periods : [];
}

export async function getPASPeriod(periodId: string): Promise<PASPeriod | null> {
    const res = await apiGet<{ period: PASPeriod }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}`,
    );
    return res.success ? res.period : null;
}

export function createPASPeriodAction(
    input: {
        name: string;
        type?: string;
        school_year: string;
        semester?: string;
        start_date: string;
        end_date: string;
        screenshot_enabled?: boolean;
        committee_chair_name?: string;
        committee_chair_nip?: string;
    },
) {
    return apiCreate<{ id: string }>('/api/pas/periods', input);
}

export function updatePASPeriodAction(
    periodId: string,
    data: {
        name?: string;
        type?: string;
        school_year?: string;
        semester?: string;
        start_date?: string;
        end_date?: string;
        committee_chair_name?: string;
        committee_chair_nip?: string;
    },
) {
    return apiSend<PASPeriod>(
        `/api/pas/periods/${encodeURIComponent(periodId)}`,
        data,
        'PATCH',
    );
}

export function updatePASPeriodCommitteeChairAction(
    periodId: string,
    data: { committee_chair_name: string; committee_chair_nip?: string },
) {
    return apiSend<{ id: string; committee_chair_name: string; committee_chair_nip: string | null }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/committee-chair`,
        data,
        'PATCH',
    );
}

export function lockPASPeriodAction(periodId: string, lock: boolean) {
    return apiSend<{ id: string; is_locked: boolean }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/lock`,
        { lock },
    );
}

export function deletePASPeriodAction(periodId: string) {
    return apiSend<{ id: string }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}`,
        undefined,
        'DELETE',
    );
}

// ── Data pendukung ───────────────────────────────────────────────────────────

/**
 * Mata pelajaran dari master data acca-app.
 *
 * Lingkup sekolah diambil dari sesi terverifikasi oleh backend.
 */
export async function listSubjects(): Promise<PASSubjectSummary[]> {
    const res = await apiGet<{ subjects: PASSubjectSummary[] }>('/api/pas/subjects');
    return res.success ? res.subjects : [];
}

export async function listOrganizationClasses(
    opts?: { activeYearOnly?: boolean },
): Promise<OrganizationClass[]> {
    const query = new URLSearchParams();
    if (opts?.activeYearOnly) query.set('activeYearOnly', 'true');

    const res = await apiGet<{ classes: OrganizationClass[] }>(`/api/pas/classes?${query.toString()}`);
    return res.success ? res.classes : [];
}

export async function listTeachersAndInvigilators(): Promise<PASStaffMember[]> {
    const res = await apiGet<{ staff: PASStaffMember[] }>('/api/pas/staff');
    return res.success ? res.staff : [];
}

// ── Sesi ─────────────────────────────────────────────────────────────────────

export async function listPASSessions(periodId: string): Promise<PASSession[]> {
    const res = await apiGet<{ sessions: PASSession[] }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/sessions`,
    );
    return res.success ? res.sessions : [];
}

export function createPASSessionAction(
    periodId: string,
    name: string,
    startTime: string,
    endTime: string,
) {
    return apiCreate<{ id: string }>(`/api/pas/periods/${encodeURIComponent(periodId)}/sessions`, {
        name,
        start_time: startTime,
        end_time: endTime,
    });
}

export function deletePASSessionAction(sessionId: string) {
    return apiSend<{ id: string }>(
        `/api/pas/sessions/${encodeURIComponent(sessionId)}`,
        undefined,
        'DELETE',
    );
}

// ── Jadwal ───────────────────────────────────────────────────────────────────

export function addPASScheduleAction(input: {
    pas_period_id: string;
    bank_id: string;
    class_id: string;
    session_id: string;
    scheduled_date: string;
    subject_id?: string;
    duration_override?: number;
    room?: string;
}) {
    return apiCreate<{ id: string }>('/api/pas/schedules', input);
}

export function removePASScheduleAction(scheduleId: string) {
    return apiSend<{ id: string }>(
        `/api/pas/schedules/${encodeURIComponent(scheduleId)}`,
        undefined,
        'DELETE',
    );
}

/**
 * `details` dipertahankan (gabungan `skipped` dengan baris baru) karena layar
 * PAS menampilkannya apa adanya di kotak peringatan.
 */
export async function generateExamsFromSchedulesAction(scheduleIds: string[]) {
    const res = await apiSend<{ created: number; skipped: string[] }>(
        '/api/pas/schedules/generate',
        { scheduleIds },
        'POST',
        { timeoutMs: 120_000 },
    );

    if (!res.success) {
        return { success: false as const, created: 0, skipped: [] as string[], error: res.error };
    }

    return {
        success: true as const,
        created: res.created,
        skipped: res.skipped,
        details: res.skipped.length > 0 ? res.skipped.join('\n') : undefined,
    };
}

export async function setPASScheduleActivationAction(scheduleId: string, active: boolean) {
    return apiSend<{ id: string; active: boolean }>(`/api/pas/schedules/${encodeURIComponent(scheduleId)}/activation`, { active }, 'PUT', { timeoutMs: 120_000 });
}

// ── Ruang ────────────────────────────────────────────────────────────────────

export async function listPASRooms(periodId: string): Promise<PASRoom[]> {
    const res = await apiGet<{ rooms: PASRoom[] }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/rooms`,
    );
    if (!res.success) throw new Error(res.error || 'Daftar ruang ujian belum dapat dimuat.');
    return res.rooms;
}

export function createPASRoomAction(periodId: string, name: string, capacity: number) {
    return apiCreate<{ id: string }>(`/api/pas/periods/${encodeURIComponent(periodId)}/rooms`, {
        name,
        capacity,
    });
}

export function deletePASRoomAction(roomId: string) {
    return apiSend<{ id: string }>(
        `/api/pas/rooms/${encodeURIComponent(roomId)}`,
        undefined,
        'DELETE',
    );
}

export function assignProctorsToRoomAction(roomId: string, userIds: string[], sessionId: string, examDate: string) {
    return apiSend<{ roomId: string; sessionId: string; examDate: string; assigned: number }>(
        `/api/pas/rooms/${encodeURIComponent(roomId)}/invigilators`,
        { userIds, sessionId, examDate },
        'PUT',
    );
}

/** Salin seluruh penugasan pengawas (semua ruang & sesi) dari satu tanggal ke tanggal lain. */
export function copyInvigilatorsAction(periodId: string, fromDate: string, toDate: string) {
    return apiSend<{ fromDate: string; toDate: string; copied: number }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/invigilators/copy`,
        { fromDate, toDate },
        'POST',
    );
}

export function assignStudentsToRoomAction(periodId: string, roomId: string, userIds: string[]) {
    return apiSend<{ roomId: string; assigned: number }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/room-students`,
        { roomId, userIds },
        'PUT',
    );
}

export function removeStudentFromRoomAction(periodId: string, userId: string) {
    return apiSend<{ periodId: string; userId: string }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/room-students/${encodeURIComponent(userId)}`,
        undefined,
        'DELETE',
    );
}

// ── Administrasi (Berita Acara & Daftar Hadir) ───────────────────────────────

export type PASAttendanceStatus = 'hadir' | 'sakit' | 'izin' | 'alpha';

export interface PASAdministrationStudentRow {
    user_id: string;
    full_name: string;
    nis: string;
    identity_number: string;
    class_name: string;
    exam_title: string;
    started_at: string | null;
    finished_at: string | null;
    attempt_status: string | null;
    status: PASAttendanceStatus;
    attendance_status: PASAttendanceStatus;
    remark: string;
}

export interface PASAdministrationSlot {
    organization: {
        id: string;
        name: string;
        logo_url: string | null;
    };
    profil_sekolah?: {
        nama?: string | null;
        jenjang?: string | null;
        jenis?: string | null;
        alamat?: string | null;
        desa_kelurahan?: string | null;
        kecamatan?: string | null;
        kabupaten_kota?: string | null;
        provinsi?: string | null;
        kode_pos?: string | null;
        telepon?: string | null;
        email?: string | null;
        website?: string | null;
        logo_url?: string | null;
        kepala_sekolah_nama?: string | null;
        kepala_sekolah_nip?: string | null;
    };
    period: {
        id: string;
        name: string;
        type: string;
        school_year: string;
        semester: string;
        start_date: string;
        end_date: string;
        is_locked: boolean;
        created_by: string | null;
        organization_name: string;
    };
    room: {
        id: string;
        name: string;
        capacity: number;
    };
    session: {
        id: string;
        name: string;
        start_time: string;
        end_time: string;
    };
    exam_date: string;
    available_dates: string[];
    schedules: Array<{
        id: string;
        bank_title: string;
        subject_name: string;
        class_name: string;
        duration_minutes: number;
    }>;
    invigilators: Array<{
        user_id: string;
        full_name: string;
        identity_number: string | null;
    }>;
    proctor_creator: {
        id: string | null;
        full_name: string;
        identity_number: string | null;
    };
    committee_chair: {
        committee_chair_name: string;
        committee_chair_nip: string;
    };
    report: {
        id: string | null;
        is_saved: boolean;
        notes: string;
        incident_summary: string;
        invigilator_id: string | null;
        invigilator_name: string;
        invigilator_nip?: string;
        proctor_id: string | null;
        proctor_name: string;
        committee_chair_name: string;
        committee_chair_nip: string;
        signature_version: number;
        integrity_valid?: boolean;
        proctor_nip?: string;
        verification_code: string;
        status?: 'draft' | 'submitted' | 'approved' | 'rejected';
        submitted_at?: string | null;
        submitted_by?: string | null;
        approved_at?: string | null;
        approved_by?: string | null;
        rejection_note?: string;
        attendance_verification_code: string;
        signature_hash: string;
        signed_at: string | null;
        updated_at: string | null;
    };
    students: PASAdministrationStudentRow[];
    counts: {
        total: number;
        hadir: number;
        sakit: number;
        izin: number;
        alpha: number;
    };
}

export interface PASVerificationResult {
    verified: boolean;
    valid?: boolean;
    integrity_valid?: boolean;
    integrity_verified?: boolean;
    verification_code: string;
    document_type?: 'berita_acara' | 'daftar_hadir';
    document_label?: string;
    paired_codes?: {
        berita_acara: string;
        daftar_hadir: string;
    };
    organization_name?: string;
    period?: {
        id: string;
        name: string;
        school_year: string;
        semester: string;
    };
    room?: {
        id: string;
        name: string;
    };
    session?: {
        id: string;
        name: string;
        start_time: string;
        end_time: string;
    };
    exam_date?: string;
    invigilator_name?: string;
    proctor_name?: string;
    committee_chair_name?: string;
    committee_chair_nip?: string;
    signature_version?: number;
    notes?: string;
    incident_summary?: string;
    signature_hash?: string;
    signed_at?: string;
    counts?: {
        total: number;
        hadir: number;
        sakit: number;
        izin: number;
        alpha: number;
    };
    message?: string;
}

export interface PASAssignmentSlotSummary {
    period: {
        id: string;
        name: string;
        type?: string;
        school_year: string;
        semester: string;
        start_date: string;
        end_date: string;
        is_locked: boolean;
        committee_chair_name?: string | null;
        committee_chair_nip?: string | null;
    };
    room: {
        id: string;
        name: string;
        capacity: number;
        student_count: number;
    };
    session: {
        id: string;
        name: string;
        start_time: string;
        end_time: string;
    };
    /** Gabungan pengawas seluruh hari. */
    invigilators: Array<{
        user_id: string;
        full_name: string;
    }>;
    /** Pengawas per tanggal (YYYY-MM-DD). */
    invigilators_by_date?: Record<string, Array<{ user_id: string; full_name: string }>>;
    /** Tanggal tugas user ini pada ruang & sesi tersebut. */
    my_dates?: string[];
    is_assigned_to_me: boolean;
    scheduled_dates: string[];
    saved_reports: Array<{
        id: string;
        exam_date: string;
        verification_code: string;
        attendance_verification_code: string;
        signed_at: string;
    }>;
}

/** Satu slot monitoring ASAS/ASAT/AM: ruang × sesi × tanggal. */
export interface PASMonitoringSlot {
    key: string;
    date: string;
    period: { id: string; name: string; type: string };
    room: { id: string; name: string; capacity: number | null };
    session: { id: string; name: string; start_time: string; end_time: string };
    invigilators: Array<{ user_id: string; full_name: string }>;
    is_mine: boolean;
    exams: Array<{ exam_id: string; schedule_id: string; bank_title: string; class_name: string; student_count: number }>;
    student_ids: string[];
    counts: { total: number; in_progress: number; finished: number; not_started: number };
}

export interface PASMonitoringSlotList {
    date: string;
    is_manager: boolean;
    available_dates: string[];
    slots: PASMonitoringSlot[];
}

/** Slot monitoring pada satu tanggal. Pengawas hanya menerima slot tugasnya. */
export async function listPASMonitoringSlots(params: { date?: string; periodId?: string }): Promise<PASMonitoringSlotList> {
    const query = new URLSearchParams();
    if (params.date) query.set('date', params.date);
    if (params.periodId) query.set('periodId', params.periodId);
    const res = await apiGet<PASMonitoringSlotList>(`/api/pas/monitoring/slots${query.toString() ? `?${query.toString()}` : ''}`);
    if (!res.success) throw new Error(res.error || 'Monitoring ruang belum dapat dimuat.');
    return { date: res.date, is_manager: res.is_manager, available_dates: res.available_dates || [], slots: res.slots || [] };
}

export async function listMyPASAssignments(): Promise<PASAssignmentSlotSummary[]> {
    const res = await apiGet<{ assignments: PASAssignmentSlotSummary[] }>('/api/pas/my-assignments');
    if (!res.success) throw new Error(res.error || 'Penugasan ruang dan sesi belum dapat dimuat.');
    return res.assignments || [];
}

export async function getPASAdministrationSlot(params: {
    periodId: string;
    roomId: string;
    sessionId: string;
    examDate?: string;
}): Promise<PASAdministrationSlot> {
    const query = new URLSearchParams({
        periodId: params.periodId,
        roomId: params.roomId,
        sessionId: params.sessionId,
    });
    if (params.examDate) query.set('examDate', params.examDate);
    const res = await apiGet<{ slot: PASAdministrationSlot }>(
        `/api/pas/administration/slot?${query.toString()}`,
    );
    if (!res.success) throw new Error(res.error || 'Data administrasi ujian belum dapat dimuat.');
    return res.slot;
}

export function savePASAdministrationSlotAction(input: {
    pas_period_id: string;
    pas_room_id: string;
    session_id: string;
    exam_date: string;
    notes?: string;
    incident_summary?: string;
    invigilator_id?: string;
    invigilator_name?: string;
    proctor_id?: string;
    proctor_name?: string;
    action?: 'save_draft' | 'submit' | 'approve';
    attendances?: Array<{
        user_id: string;
        status: PASAttendanceStatus;
        remark?: string;
    }>;
}) {
    return apiSend<{ slot: PASAdministrationSlot }>('/api/pas/administration/slot', input, 'PUT');
}

export interface PASAdministrationOverviewItem {
    room_id: string;
    room_name: string;
    session_id: string;
    session_name: string;
    start_time: string;
    end_time: string;
    exam_date: string;
    assigned_invigilators: string[];
    student_count: number;
    report_id: string | null;
    signature_version?: number;
    status: 'draft' | 'submitted' | 'approved' | 'rejected';
    invigilator_name: string;
    proctor_name: string;
    submitted_at: string | null;
    approved_at: string | null;
    rejection_note?: string;
    verification_code?: string;
    attendance_verification_code?: string;
    counts: {
        total: number;
        hadir: number;
        sakit: number;
        izin: number;
        alpha: number;
    };
}

export async function getPASPeriodAdministrationOverview(
    periodId: string,
): Promise<PASAdministrationOverviewItem[]> {
    const res = await apiGet<PASAdministrationOverviewItem[]>(
        `/api/pas/administration/overview?periodId=${encodeURIComponent(periodId)}`,
    );
    if (!res.success) throw new Error(res.error || 'Overview administrasi belum dapat dimuat.');
    return (Array.isArray(res) ? res : (res as any).data || (res as any).overview || []) as PASAdministrationOverviewItem[];
}

export function approvePASAdministrationSlotAction(input: {
    pas_period_id: string;
    pas_room_id: string;
    session_id: string;
    exam_date: string;
}) {
    return apiSend<{ slot: PASAdministrationSlot }>(
        '/api/pas/administration/slot/approve',
        input,
        'POST',
    );
}

export function rejectPASAdministrationSlotAction(input: {
    pas_period_id: string;
    pas_room_id: string;
    session_id: string;
    exam_date: string;
    rejection_note?: string;
}) {
    return apiSend<{ slot: PASAdministrationSlot }>(
        '/api/pas/administration/slot/reject',
        input,
        'POST',
    );
}


