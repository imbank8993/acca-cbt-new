import { apiGet, apiSend } from './client';

/**
 * Dasbor staf sekolah. Menggantikan `app/actions/proktor.ts`.
 *
 * Berkas lama memuat 45 aksi; 17 di antaranya tidak punya satu pun pemanggil dan
 * tidak dipindahkan — seluruh pengelolaan anggota, impor anggota/mapel/tahun
 * ajaran, penutupan otomatis terjadwal, dan pengelolaan mapel milik CBT sendiri
 * yang kembar dengan master data acca-app. Alasannya dicatat di
 * `apps/api/src/proctor/proctor.service.ts`.
 *
 * `userId` tidak lagi dikirim di mana pun. Yang paling berbahaya adalah
 * `isUserProctor(userId)` dan `createExamAction({ userId })`: keduanya menerima
 * UUID dari browser sebagai penentu peran, sehingga seorang Guru bisa mengirim
 * id Proktor untuk melewati gerbang pembuatan ujian PAS/PAT.
 */

// ── Organisasi & identitas ───────────────────────────────────────────────────

export interface ProctorOrganization {
    id: string;
    name: string;
}

export async function getProctorOrganization(): Promise<ProctorOrganization | null> {
    const res = await apiGet<{ organization: ProctorOrganization | null }>(
        '/api/proctor/organization',
    );
    return res.success ? res.organization : null;
}

export async function getOrganizationStats() {
    const empty = {
        totalMembers: 0,
        totalBanks: 0,
        ongoingExams: 0,
        draftExams: 0,
        finishedExams: 0,
    };

    const res = await apiGet<{ stats: typeof empty }>('/api/proctor/stats');
    return res.success ? res.stats : empty;
}

interface ResolvedRoles {
    roles: string[];
    isProctor: boolean;
    isGuru: boolean;
    hasDualRole: boolean;
}

/**
 * Peran pemanggil. Dibaca sekali lalu dipakai ulang oleh kedua pemeriksaan di
 * bawah, supaya membuka satu halaman tidak menghasilkan dua permintaan identik.
 */
async function resolveRoles(): Promise<ResolvedRoles> {
    const res = await apiGet<ResolvedRoles>('/api/proctor/roles');
    return res.success
        ? res
        : { roles: [], isProctor: false, isGuru: false, hasDualRole: false };
}

export async function isUserProctor(): Promise<boolean> {
    return (await resolveRoles()).isProctor;
}

export async function hasUserDualRole(): Promise<boolean> {
    return (await resolveRoles()).hasDualRole;
}

export async function getRecentLogins(limit = 10): Promise<any[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    const res = await apiGet<{ logins: any[] }>(`/api/proctor/recent-logins?${query}`);
    return res.success ? res.logins : [];
}

// ── Tahun ajaran & mata pelajaran ────────────────────────────────────────────

export async function listSchoolYears(): Promise<any[]> {
    const res = await apiGet<{ schoolYears: any[] }>('/api/proctor/school-years');
    return res.success ? res.schoolYears : [];
}

export async function getActiveSchoolYear(): Promise<any | null> {
    const res = await apiGet<{ schoolYear: any }>('/api/proctor/school-years/active');
    return res.success ? res.schoolYear : null;
}

export function createSchoolYearAction(
    data: { year: string; startDate?: string; endDate?: string },
) {
    return apiSend<{ id: string }>('/api/proctor/school-years', {
        ...data,
    });
}

export async function listOrganizationSchoolYears(): Promise<string[]> {
    const res = await apiGet<{ years: string[] }>('/api/proctor/class-school-years');
    return res.success ? res.years : [];
}

export async function listSubjects(): Promise<any[]> {
    const res = await apiGet<{ subjects: any[] }>('/api/proctor/subjects');
    return res.success ? res.subjects : [];
}

// ── Kelas ────────────────────────────────────────────────────────────────────

export async function listOrganizationClasses(
    opts?: { activeYearOnly?: boolean },
): Promise<any[]> {
    const query = new URLSearchParams();
    if (opts?.activeYearOnly) query.set('activeYearOnly', 'true');

    const res = await apiGet<{ classes: any[] }>(`/api/proctor/classes?${query}`);
    return res.success ? res.classes : [];
}

export function createClassAction(
    name: string,
    type: 'reguler' | 'tambahan',
    schoolYear?: string,
) {
    return apiSend<{ id: string }>('/api/proctor/classes', {
        name,
        type,
        schoolYear,
    });
}

export function editClassAction(
    classId: string,
    name: string,
    type: 'reguler' | 'tambahan',
    schoolYear?: string,
) {
    return apiSend<{ id: string }>(
        `/api/proctor/classes/${encodeURIComponent(classId)}`,
        { name, type, schoolYear },
        'PATCH',
    );
}

export function deleteClassAction(classId: string) {
    return apiSend<{ id: string }>(
        `/api/proctor/classes/${encodeURIComponent(classId)}`,
        undefined,
        'DELETE',
    );
}

export async function importClassesAction(
    classes: { name: string; type: 'reguler' | 'tambahan'; schoolYear?: string }[],
) {
    const res = await apiSend<{
        successCount: number;
        failedCount: number;
        errors: { name: string; error: string }[];
    }>('/api/proctor/classes/import', { classes });

    return res.success
        ? { successCount: res.successCount, failedCount: res.failedCount, errors: res.errors }
        : {
              successCount: 0,
              failedCount: classes.length,
              errors: [{ name: '-', error: res.error }],
          };
}

export async function listClassStudents(classIds: string[]): Promise<Record<string, any[]>> {
    if (classIds.length === 0) return {};

    const res = await apiSend<{ members: Record<string, any[]> }>(
        '/api/proctor/classes/members',
        { classIds },
    );
    return res.success ? res.members : {};
}

export async function getStudentsByClassAction(
    classId: string,
    isAdditional = false,
): Promise<any[]> {
    const res = await apiGet<{ students: any[] }>(
        `/api/proctor/classes/${encodeURIComponent(classId)}/students?additional=${isAdditional}`,
    );
    return res.success ? res.students : [];
}

// ── Ujian ────────────────────────────────────────────────────────────────────

export async function listOrganizationExams(): Promise<any[]> {
    const res = await apiGet<{ exams: any[] }>('/api/proctor/exams');
    return res.success ? res.exams : [];
}

export interface ExamInput {
    title: string;
    description?: string;
    duration: number;
    examType?: 'daily' | 'pas' | 'pat' | 'lainnya' | 'assignment';
    startTime?: string;
    endTime?: string;
    randomizeQuestions?: boolean;
    randomizeOptions?: boolean;
    showResults?: boolean;
    isSafeMode?: boolean;
    scoringType?: string;
    isPublic?: boolean;
    documentUrl?: string;
    videoUrl?: string;
    assignmentDescription?: string;
    allowFileUpload?: boolean;
    allowedFileTypes?: string[];
    requireBank?: boolean;
}

export function createExamAction(
    data: ExamInput & { subjectId?: string; questionBankId?: string },
) {
    return apiSend<{ id: string }>('/api/proctor/exams', data);
}

export function editExamAction(examId: string, data: ExamInput) {
    return apiSend<{ id: string }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}`,
        data,
        'PATCH',
    );
}

export function publishExamAction(examId: string, publish: boolean) {
    return apiSend<{ id: string }>(`/api/proctor/exams/${encodeURIComponent(examId)}/publish`, {
        publish,
    });
}

export function assignExamAction(
    examId: string,
    classIds: string[],
    userIds: string[],
    activate = true,
) {
    return apiSend<{ examId: string }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/assignments`,
        { classIds, userIds, activate },
        'PUT',
    );
}

export async function listExamAssignmentsAction(examIds: string[]): Promise<{
    targets: { exam_id: string; class_id: string | null; additional_class_id: string | null }[];
    participants: { exam_id: string; user_id: string; class_id: string | null }[];
}> {
    if (examIds.length === 0) return { targets: [], participants: [] };

    const res = await apiSend<{
        targets: any[];
        participants: any[];
    }>('/api/proctor/exams/assignments', { examIds });

    return res.success
        ? { targets: res.targets, participants: res.participants }
        : { targets: [], participants: [] };
}

// ── Pemantauan & hasil ───────────────────────────────────────────────────────

export async function getExamAttemptsAction(examId: string): Promise<any[]> {
    const res = await apiGet<{ attempts: any[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/attempts`,
    );
    return res.success ? res.attempts : [];
}

export interface ViolationEvent {
    id: string;
    attemptId: string;
    studentName: string;
    violationType: string;
    violationCount: number;
    timestamp: string;
    duration?: string;
}

/**
 * Pelanggaran terbaru sebuah ujian.
 *
 * Menggantikan siaran realtime Supabase yang dulu mengisi umpan ini. Karena
 * sumbernya kini log di basis data, umpannya tetap terisi setelah halaman
 * pemantauan dimuat ulang — sesuatu yang tidak pernah berlaku pada versi siaran.
 */
export async function getRecentViolationsAction(
    examId: string,
    limit = 20,
): Promise<ViolationEvent[]> {
    const res = await apiGet<{ violations: ViolationEvent[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/violations?limit=${limit}`,
    );
    return res.success ? res.violations : [];
}

export async function getExamAnswersForAnalysisAction(
    examId: string,
): Promise<{ questions: any[]; answers: any[] }> {
    const res = await apiGet<{ questions: any[]; answers: any[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/item-analysis`,
    );
    return res.success ? { questions: res.questions, answers: res.answers } : { questions: [], answers: [] };
}

export async function getAttemptFullDetailsAction(attemptId: string) {
    const res = await apiGet<{ attempt: any; answers: any[]; securityLogs: any[] }>(
        `/api/proctor/attempts/${encodeURIComponent(attemptId)}`,
    );

    // Versi lama mengembalikan `null` saat gagal; layar analitik memakainya
    // untuk menampilkan keadaan kosong.
    return res.success
        ? { attempt: res.attempt, answers: res.answers, securityLogs: res.securityLogs }
        : null;
}

export async function getAssignmentSubmissionsAction(examId: string) {
    const res = await apiGet<{ exam: any; submissions: any[]; classes: any[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/submissions`,
    );

    return res.success
        ? {
              success: true as const,
              exam: res.exam,
              submissions: res.submissions,
              classes: res.classes,
          }
        : {
              success: false as const,
              error: res.error,
              exam: null,
              submissions: [] as any[],
              classes: [] as any[],
          };
}

export function gradeAssignmentAction(attemptId: string, score: number, feedback: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctor/attempts/${encodeURIComponent(attemptId)}/grade`,
        { score, feedback },
    );
}
