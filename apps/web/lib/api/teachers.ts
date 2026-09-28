import { getSessionUser } from '../session';
import { apiCreate,apiGet,apiSend } from './client';
import type { OrganizationClass } from './proctor';

/**
 * Klien modul guru. Menggantikan `app/actions/guru.ts`.
 *
 * Bentuk balasannya dipertahankan (`{ success, ... }`) supaya penanganan galat
 * di halaman tidak ikut berubah. Yang berubah: `userId` dan `orgId` tidak lagi
 * dikirim dari browser sebagai identitas — NestJS membacanya dari token.
 */

export interface GuruOrganization {
    id: string;
    name: string | null;
}

export interface GuruStats {
    totalMembers: number;
    totalBanks: number;
    draftExams: number;
    ongoingExams: number;
    finishedExams: number;
}

export interface GuruStudent {
    userId: string;
    fullName: string;
    email: string;
}

/** Organisasi pemanggil. Tidak lagi menerima userId — identitas dari token. */
export async function getGuruOrganization(): Promise<GuruOrganization | null> {
    const user = await getSessionUser();
    return user
        ? { id: user.organizationId, name: user.organizationName || 'Sekolah' }
        : null;
}

export async function listGuruClasses(): Promise<OrganizationClass[]> {
    const res = await apiGet<{ classes: OrganizationClass[] }>('/api/teachers/classes');
    // Versi lama mengembalikan array kosong saat gagal, bukan melempar. Halaman
    // pemanggilnya mengandalkan itu.
    return res.success ? res.classes : [];
}

export function createTambahanClass(name: string) {
    return apiCreate<{ data: OrganizationClass }>('/api/teachers/classes', { name });
}

export function deleteTambahanClass(classId: string) {
    return apiSend<{ id: string }>(
        `/api/teachers/classes/${encodeURIComponent(classId)}`,
        undefined,
        'DELETE',
    );
}

export function assignStudentToClass(classId: string, studentId: string) {
    return apiSend<{ classId: string }>(
        `/api/teachers/classes/${encodeURIComponent(classId)}/students`,
        { studentId },
    );
}

export async function listStudentsForGuru(): Promise<GuruStudent[]> {
    const res = await apiGet<{ students: GuruStudent[] }>('/api/teachers/students');
    return res.success ? res.students : [];
}

export async function getAttemptDetailsForGrading(attemptId: string) {
    const res = await apiGet<{ attempt: any; essayAnswers: any[] }>(
        `/api/teachers/grading/${encodeURIComponent(attemptId)}`,
    );
    // Versi lama mengembalikan null saat gagal; halaman pemanggilnya menampilkan
    // keadaan kosong berdasarkan itu.
    return res.success ? { attempt: res.attempt, essayAnswers: res.essayAnswers } : null;
}

export function submitEssayGrades(attemptId: string, grades: Record<string, number>) {
    return apiSend<{ totalScore: number }>(
        `/api/teachers/grading/${encodeURIComponent(attemptId)}`,
        { grades },
        'PUT',
    );
}

export async function getGuruOrganizationStats(): Promise<GuruStats> {
    const res = await apiGet<{ stats: GuruStats }>('/api/teachers/stats');
    return res.success
        ? res.stats
        : { totalMembers: 0, totalBanks: 0, draftExams: 0, ongoingExams: 0, finishedExams: 0 };
}
