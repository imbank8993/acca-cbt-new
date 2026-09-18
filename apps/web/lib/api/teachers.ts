import { apiGet, apiSend } from './client';

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
    const res = await apiGet<{ organization: GuruOrganization | null }>(
        '/api/teachers/organization',
    );
    return res.success ? res.organization : null;
}

export async function listGuruClasses(organizationId: string): Promise<any[]> {
    const res = await apiGet<{ classes: any[] }>(
        `/api/teachers/classes?organizationId=${encodeURIComponent(organizationId)}`,
    );
    // Versi lama mengembalikan array kosong saat gagal, bukan melempar. Halaman
    // pemanggilnya mengandalkan itu.
    return res.success ? res.classes : [];
}

export function createTambahanClass(organizationId: string, name: string) {
    return apiSend<{ data: any }>('/api/teachers/classes', { organizationId, name });
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

export async function listStudentsForGuru(organizationId: string): Promise<GuruStudent[]> {
    const res = await apiGet<{ students: GuruStudent[] }>(
        `/api/teachers/students?organizationId=${encodeURIComponent(organizationId)}`,
    );
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

export async function getGuruOrganizationStats(organizationId: string): Promise<GuruStats> {
    const res = await apiGet<{ stats: GuruStats }>(
        `/api/teachers/stats?organizationId=${encodeURIComponent(organizationId)}`,
    );
    return res.success
        ? res.stats
        : { totalMembers: 0, totalBanks: 0, draftExams: 0, ongoingExams: 0, finishedExams: 0 };
}
