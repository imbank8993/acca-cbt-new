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
    },
) {
    return apiCreate<{ id: string }>('/api/pas/periods', input);
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

// ── Ruang ────────────────────────────────────────────────────────────────────

export async function listPASRooms(periodId: string): Promise<PASRoom[]> {
    const res = await apiGet<{ rooms: PASRoom[] }>(
        `/api/pas/periods/${encodeURIComponent(periodId)}/rooms`,
    );
    return res.success ? res.rooms : [];
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

export function assignProctorsToRoomAction(roomId: string, userIds: string[]) {
    return apiSend<{ roomId: string; assigned: number }>(
        `/api/pas/rooms/${encodeURIComponent(roomId)}/invigilators`,
        { userIds },
        'PUT',
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
