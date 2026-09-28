import { getSessionUser } from '../session';
import { apiCreate,apiGet,apiSend } from './client';
import type { QuestionRecord } from './questions';

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

export interface RecentLogin {
    id: string;
    userId: string;
    isActive: boolean;
    lastLoginAt: string | null;
    fullName: string;
    avatarUrl: string | null;
    role: string;
}

export interface SchoolYear {
    id: string;
    year: string;
    start_date?: string | null;
    end_date?: string | null;
    is_active?: boolean;
}

export interface SchoolSubject {
    id: string;
    name: string;
    code?: string | null;
}

export interface OrganizationClass {
    id: string;
    name: string;
    type: 'reguler' | 'tambahan';
    school_year?: string | null;
    member_count?: number;
    student_count?: number;
    studentCount?: number;
    program?: string | null;
    join_code?: string | null;
    canEdit?: boolean;
    canDelete?: boolean;
}

export interface ClassStudent {
    id: string;
    name?: string | null;
    user_id?: string;
    full_name?: string | null;
    identity_number?: string | null;
    avatar_url?: string | null;
    email?: string | null;
    profiles?: {
        id?: string;
        full_name?: string | null;
        identity_number?: string | null;
        avatar_url?: string | null;
    } | null;
}

export interface OrganizationExam {
    id: string;
    organization_id?: string;
    title: string;
    description?: string | null;
    duration?: number;
    duration_minutes?: number;
    exam_type?: string | null;
    status?: string | null;
    is_published?: boolean;
    start_time?: string | null;
    end_time?: string | null;
    created_at?: string;
    subject_id?: string | null;
    question_bank_id?: string | null;
    randomize_questions?: boolean;
    randomize_options?: boolean;
    show_results?: boolean;
    scoring_type?: string | null;
    metadata?: {
        assignment_description?: string;
        allow_file_upload?: boolean;
        allowed_file_types?: string[];
        document_url?: string;
        is_public?: boolean;
        is_safe_mode?: boolean;
        require_bank?: boolean;
        video_url?: string;
        [key: string]: unknown;
    } | null;
}

export interface ExamAttemptRecord {
    id: string;
    exam_id: string;
    user_id: string;
    status: string;
    started_at?: string | null;
    finished_at?: string | null;
    last_heartbeat_at?: string | null;
    total_score?: number | null;
    kelas_name?: string | null;
    warning_count?: number;
    tab_switch_count?: number;
    violation_breakdown?: {
        pindah_tab: number;
        close_tab: number;
        lainnya: number;
    } | null;
    detailed_scores?: {
        classical?: number;
        irt_1pl?: number;
        irt_2pl?: number;
        irt_3pl?: number;
    } | null;
    connection_status?: string | null;
    score_irt?: number | null;
    needs_manual_grading?: boolean;
    metadata?: Record<string, unknown> | null;
    profiles?: { id?: string; full_name?: string | null; identity_number?: string | null } | null;
    exams?: OrganizationExam | null;
}

export interface ExamAnswerRecord {
    id: string;
    attempt_id?: string;
    question_id: string;
    selected_option_id?: string | null;
    essay_answer?: unknown;
    score?: number | null;
    is_correct?: boolean | null;
    questions?: QuestionRecord | null;
}

export interface SecurityLogRecord {
    id: string;
    attempt_id?: string;
    event_type?: string;
    created_at?: string;
    metadata?: Record<string, unknown> | null;
}

export interface AssignmentSubmission {
    userId: string;
    fullName: string;
    identityNumber: string;
    attemptId: string | null;
    status: 'belum_mulai' | 'sedang_dikerjakan' | 'sudah_kumpul';
    score: number | null;
    submittedAt: string | null;
    needsGrading: boolean;
    fileUrls: string[];
    textSubmission: string;
    teacherFeedback: string;
    teacherScore: number | null;
}

export async function getProctorOrganization(): Promise<ProctorOrganization | null> {
    const user = await getSessionUser();
    return user
        ? { id: user.organizationId, name: user.organizationName || 'Sekolah' }
        : null;
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

export async function getRecentLogins(limit = 10): Promise<RecentLogin[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    const res = await apiGet<{ logins: RecentLogin[] }>(`/api/proctor/recent-logins?${query}`);
    return res.success ? res.logins : [];
}

// ── Tahun ajaran & mata pelajaran ────────────────────────────────────────────

export async function listSchoolYears(): Promise<SchoolYear[]> {
    const res = await apiGet<{ schoolYears: SchoolYear[] }>('/api/proctor/school-years');
    return res.success ? res.schoolYears : [];
}

export async function getActiveSchoolYear(): Promise<SchoolYear | null> {
    const res = await apiGet<{ schoolYear: SchoolYear }>('/api/proctor/school-years/active');
    return res.success ? res.schoolYear : null;
}

export function createSchoolYearAction(
    data: { year: string; startDate?: string; endDate?: string },
) {
    return apiCreate<{ id: string }>('/api/proctor/school-years', {
        ...data,
    });
}

export async function listOrganizationSchoolYears(): Promise<string[]> {
    const res = await apiGet<{ years: string[] }>('/api/proctor/class-school-years');
    return res.success ? res.years : [];
}

export async function listSubjects(): Promise<SchoolSubject[]> {
    const res = await apiGet<{ subjects: SchoolSubject[] }>('/api/proctor/subjects');
    return res.success ? res.subjects : [];
}

// ── Kelas ────────────────────────────────────────────────────────────────────

export async function listOrganizationClasses(
    opts?: { activeYearOnly?: boolean },
): Promise<OrganizationClass[]> {
    const query = new URLSearchParams();
    if (opts?.activeYearOnly) query.set('activeYearOnly', 'true');

    const res = await apiGet<{ classes: OrganizationClass[] }>(`/api/proctor/classes?${query}`);
    return res.success ? res.classes : [];
}

export function createClassAction(
    name: string,
    type: 'reguler' | 'tambahan',
    schoolYear?: string,
) {
    return apiCreate<{ id: string }>('/api/proctor/classes', {
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
    const res = await apiCreate<{
        successCount: number;
        failedCount: number;
        errors: { name: string; error: string }[];
    }>('/api/proctor/classes/import', { classes }, { timeoutMs: 60_000 });

    return res.success
        ? { successCount: res.successCount, failedCount: res.failedCount, errors: res.errors }
        : {
              successCount: 0,
              failedCount: classes.length,
              errors: [{ name: '-', error: res.error }],
          };
}

export async function listClassStudents(classIds: string[]): Promise<Record<string, ClassStudent[]>> {
    if (classIds.length === 0) return {};

    const res = await apiSend<{ members: Record<string, ClassStudent[]> }>(
        '/api/proctor/classes/members',
        { classIds },
    );
    return res.success ? res.members : {};
}

export async function getStudentsByClassAction(
    classId: string,
    isAdditional = false,
): Promise<ClassStudent[]> {
    const res = await apiGet<{ students: ClassStudent[] }>(
        `/api/proctor/classes/${encodeURIComponent(classId)}/students?additional=${isAdditional}`,
    );
    return res.success ? res.students : [];
}

// ── Ujian ────────────────────────────────────────────────────────────────────

export async function listOrganizationExams(): Promise<OrganizationExam[]> {
    const res = await apiGet<{ exams: OrganizationExam[] }>('/api/proctor/exams');
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
    return apiCreate<{ id: string }>('/api/proctor/exams', data);
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
    participantAssignments: { userId: string; classId: string }[],
    activate = true,
) {
    return apiSend<{ examId: string }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/assignments`,
        { classIds, participantAssignments, activate },
        'PUT',
    );
}

export async function listExamAssignmentsAction(examIds: string[]): Promise<{
    targets: { exam_id: string; class_id: string | null; additional_class_id: string | null }[];
    participants: { exam_id: string; user_id: string; class_id: string | null }[];
}> {
    if (examIds.length === 0) return { targets: [], participants: [] };

    const res = await apiSend<{
        targets: { exam_id: string; class_id: string | null; additional_class_id: string | null }[];
        participants: { exam_id: string; user_id: string; class_id: string | null }[];
    }>('/api/proctor/exams/assignments', { examIds });

    return res.success
        ? { targets: res.targets, participants: res.participants }
        : { targets: [], participants: [] };
}

// ── Pemantauan & hasil ───────────────────────────────────────────────────────

export async function getExamAttemptsAction(examId: string): Promise<ExamAttemptRecord[]> {
    const res = await apiGet<{ attempts: ExamAttemptRecord[] }>(
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
): Promise<{ questions: QuestionRecord[]; answers: ExamAnswerRecord[] }> {
    const res = await apiGet<{ questions: QuestionRecord[]; answers: ExamAnswerRecord[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/item-analysis`,
    );
    return res.success ? { questions: res.questions, answers: res.answers } : { questions: [], answers: [] };
}

export async function getAttemptFullDetailsAction(attemptId: string) {
    const res = await apiGet<{ attempt: ExamAttemptRecord; answers: ExamAnswerRecord[]; securityLogs: SecurityLogRecord[] }>(
        `/api/proctor/attempts/${encodeURIComponent(attemptId)}`,
    );

    // Versi lama mengembalikan `null` saat gagal; layar analitik memakainya
    // untuk menampilkan keadaan kosong.
    return res.success
        ? { attempt: res.attempt, answers: res.answers, securityLogs: res.securityLogs }
        : null;
}

export async function getAssignmentSubmissionsAction(examId: string) {
    const res = await apiGet<{ exam: OrganizationExam; submissions: AssignmentSubmission[]; classes: OrganizationClass[] }>(
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
              submissions: [] as AssignmentSubmission[],
              classes: [] as OrganizationClass[],
          };
}

export function gradeAssignmentAction(attemptId: string, score: number, feedback: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctor/attempts/${encodeURIComponent(attemptId)}/grade`,
        { score, feedback },
    );
}
