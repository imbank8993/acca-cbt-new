import { getSessionUser } from '../session';
import { apiCreate,apiGet,apiSend } from './client';
import type { AnswerValue,Question } from '@/app/types';
import type { QuestionOptionRecord, QuestionRecord } from './questions';

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

export interface LoginHistoryRecord {
    id: string;
    userId: string;
    fullName: string;
    avatarUrl: string | null;
    role: string | null;
    loginMethod: string;
    ipAddress: string | null;
    userAgent: string | null;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    success: boolean;
    failureReason: string | null;
    createdAt: string;
}

export interface LoginStats {
    todayTotal: number;
    todayUnique: number;
    weekTotal: number;
    todayFailed: number;
}

export interface OrganizationStats {
    totalMembers: number;
    totalBanks: number;
    ongoingExams: number;
    draftExams: number;
    finishedExams: number;
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
    canManage?: boolean;
    canCorrectKeys?: boolean;
    canResetParticipants?: boolean;
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
    subject?: string | null;
    question_bank_id?: string | null;
    question_bank_title?: string | null;
    randomize_questions?: boolean;
    randomize_options?: boolean;
    show_results?: boolean;
    scoring_type?: string | null;
    creatorName?: string | null;
    metadata?: {
        show_answer_keys?: boolean;
        assignment_description?: string;
        allow_file_upload?: boolean;
        allowed_file_types?: string[];
        document_url?: string;
        is_public?: boolean;
        is_safe_mode?: boolean;
        max_violations?: number | null;
        require_bank?: boolean;
        video_url?: string;
        [key: string]: unknown;
    } | null;
}

export interface ExamAttemptRecord {
    pas_location?: {
        status: 'assigned' | 'unassigned' | 'unavailable';
        room_id: string | null;
        room_name: string | null;
        session_id: string | null;
        session_name: string | null;
        invigilators: Array<{ id: string; full_name: string | null }>;
    } | null;
    canReset?: boolean;
    client_context?: { browser: string | null; os: string | null; ip_address: string | null; observed_at: string } | null;
    server_now?: string;
    last_seen_at?: string | null;
    deadline_at?: string | null;
    remaining_seconds?: number | null;
    saved_answer_count?: number;
    total_questions?: number;
    unanswered_count?: number;
    last_answer_saved_at?: string | null;
    grading_status?: 'pending' | 'manual' | 'complete' | 'not_submitted';
    attention_reasons?: string[];
    sync_health?: {
        localAnswerCount: number;
        pendingAnswerCount: number;
        storageState: 'healthy' | 'fallback' | 'unavailable' | 'unknown';
        receivedAt: string;
        fresh: boolean;
    } | null;
    monitoring_history?: MonitoringHistoryEvent[];
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
        keluar_fullscreen?: number;
        shortcut_terlarang?: number;
        salin_tempel?: number;
        klik_kanan?: number;
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
    profiles?: { id?: string; full_name?: string | null; avatar_url?: string | null; identity_number?: string | null; email?: string | null } | null;
    exams?: OrganizationExam | null;
}

export interface MonitoringHistoryEvent {
    observed_again_at?: string | null;
    disconnected_at?: string | null;
    remaining_at_disconnect_seconds?: number | null;
    remaining_at_last_seen_seconds?: number | null;
    remaining_at_reconnect_seconds?: number | null;
    type: string;
    at: string;
    actor_id?: string | null;
    actor_name?: string | null;
    reason?: string | null;
    previous_deadline?: string | null;
    recovery_until?: string | null;
    pending_answer_count?: number | null;
    storage_state?: string | null;
    gap_seconds?: number | null;
    last_seen_at?: string | null;
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

export interface AttemptDetailAnswer {
    id: string;
    question_id: string;
    selected_option_id: string | null;
    essay_answer: AnswerValue;
    score: number | null;
    is_correct: boolean | null;
    needs_manual_grading?: boolean;
    bank_questions: Question | null;
}

export interface AttemptSecurityLog {
    id: string;
    attempt_id?: string;
    event_type: string;
    created_at: string;
    metadata?: {
        duration?: string | number;
        duration_seconds?: string | number;
        [key: string]: unknown;
    } | null;
}

export interface AttemptFullDetails {
    canManage?: boolean;
    attempt: ExamAttemptRecord;
    answers: AttemptDetailAnswer[];
    securityLogs: AttemptSecurityLog[];
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

export async function getOrganizationStats(): Promise<OrganizationStats> {
    const empty: OrganizationStats = {
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

export async function getLoginHistory(limit = 20): Promise<{ history: LoginHistoryRecord[]; stats: LoginStats | null }> {
    const query = new URLSearchParams({ limit: String(limit) });
    const res = await apiGet<{ history: LoginHistoryRecord[]; stats: LoginStats }>(`/api/proctor/login-history?${query}`);
    return res.success
        ? { history: res.history ?? [], stats: res.stats ?? null }
        : { history: [], stats: null };
}

export interface TopScorer {
    rank: number;
    userId: string;
    fullName: string;
    identityNumber: string | null;
    score: number;
    finishedAt: string | null;
}

export interface ExamTopScorers {
    scoreLabel: string;
    scoredCount: number;
    examId: string;
    title: string;
    examType: string | null;
    participantCount: number;
    lastFinishedAt: string | null;
    topScorers: TopScorer[];
}

/** Tiga peraih nilai tertinggi untuk ujian-ujian yang paling baru dikerjakan. */
export async function getTopScorers(examLimit = 6): Promise<ExamTopScorers[]> {
    const query = new URLSearchParams({ limit: String(examLimit) });
    const res = await apiGet<{ exams: ExamTopScorers[] }>(`/api/proctor/top-scorers?${query}`);
    return res.success ? res.exams ?? [] : [];
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
    let res = await apiGet<{ exams: OrganizationExam[] }>('/api/proctor/exams');
    if (!res.success && res.retryable) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        res = await apiGet<{ exams: OrganizationExam[] }>('/api/proctor/exams');
    }
    return res.success ? res.exams : [];
}

export interface ExamInput {
    title: string;
    description?: string;
    duration: number;
    examType?: 'daily' | 'pas' | 'pat' | 'am' | 'tryout' | 'lainnya' | 'assignment';
    timeZone?: string;
    startTime?: string;
    endTime?: string;
    randomizeQuestions?: boolean;
    randomizeOptions?: boolean;
    showResults?: boolean;
    studentScoreType?: 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';
    showAnswerKeys?: boolean;
    isSafeMode?: boolean;
    screenshotEnabled?: boolean;
    maxViolations?: number | null;
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
    const res = await getExamAttemptsResult(examId);
    if (!res.success) throw new Error(res.error || 'Data peserta monitoring belum dapat dimuat.');
    return res.attempts;
}

export async function getExamAttemptsResult(examId: string) {
    const res = await apiGet<{ attempts: ExamAttemptRecord[] }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/attempts`,
    );
    return res.success
        ? { success: true as const, attempts: res.attempts }
        : { success: false as const, attempts: [] as ExamAttemptRecord[], error: res.error };
}

export interface ViolationEvent {
    id: string;
    attemptId: string;
    studentName: string;
    violationType: string;
    violationLabel: string;
    violationCount: number;
    timestamp: string;
    duration?: string;
    metadata?: Record<string, unknown>;
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

export interface StudentAnswerSummary {
    attempt_id: string;
    student_name: string;
    class_name?: string;
    student_nis?: string;
    identity_number?: string;
    score: number;
    display_answer: string;
    submitted_answer?: string;
    is_correct: boolean | null;
}

export interface DistractorOptionStat {
    option_id: string;
    option_letter: string;
    option_label?: string;
    option_text: string;
    is_correct: boolean;
    count: number;
    percentage: number;
    student_names: string[];
    selected_by?: Array<{ student_name: string; class_name?: string }>;
}

export interface DetailedItemResult {
    id: string;
    number: number;
    question_text: string;
    type: string;
    score_default: number;
    key_display: string;
    options: QuestionOptionRecord[];
    total_participants: number;
    total_answered: number;
    total_correct: number;
    total_incorrect: number;
    total_ungraded: number;
    total_unanswered: number;
    incorrect_percentage: number;
    difficulty_index: number;
    difficulty_label: string;
    discrimination_index: number;
    discrimination_label: string;
    correct_students: StudentAnswerSummary[];
    wrong_students: StudentAnswerSummary[];
    ungraded_students: StudentAnswerSummary[];
    unanswered_students: StudentAnswerSummary[];
    distractor_distribution: DistractorOptionStat[];
}

export interface StudentItemCell {
    score: number;
    is_correct: boolean | null;
    display_answer: string;
    status: 'correct' | 'wrong' | 'ungraded' | 'unanswered';
}

export interface StudentItemMatrixRow {
    attempt_id: string;
    student_name: string;
    student_nis?: string;
    class_name?: string;
    status: string;
    total_score: number;
    total_correct: number;
    total_wrong: number;
    total_unanswered: number;
    items: Record<string, StudentItemCell>;
}

export interface DetailedItemAnalysisResponse {
    generated_at?: string;
    question_version_source?: 'frozen' | 'legacy_current_bank';
    exam_id: string;
    total_questions: number;
    total_participants: number;
    items: DetailedItemResult[];
    matrix: StudentItemMatrixRow[];
}

export interface ItemAnalysis {
    id: string;
    number?: number;
    qText: string;
    type: string;
    options: QuestionOptionRecord[];
    total: number;
    correct: number;
    incorrect: number;
    ungraded: number;
    unanswered?: number;
    keyDisplay?: string;
    difficultyIndex?: number;
    difficultyLabel?: string;
    discriminationIndex?: number;
    discriminationLabel?: string;
    wrongStudents: StudentAnswerSummary[];
    correctStudents: StudentAnswerSummary[];
    ungradedStudents?: StudentAnswerSummary[];
    unansweredStudents?: StudentAnswerSummary[];
    distractorDistribution?: DistractorOptionStat[];
    incorrectPercentage: number;
}

export async function getExamAnswersForAnalysisAction(
    examId: string,
): Promise<{
    questions: QuestionRecord[];
    answers: ExamAnswerRecord[];
    detailed: DetailedItemAnalysisResponse | null;
}> {
    const res = await apiGet<{
        questions: QuestionRecord[];
        answers: ExamAnswerRecord[];
        detailed?: DetailedItemAnalysisResponse | null;
    }>(
        `/api/proctor/exams/${encodeURIComponent(examId)}/item-analysis`,
        { timeoutMs: 60_000 },
    );
    return res.success
        ? { questions: res.questions, answers: res.answers, detailed: res.detailed ?? null }
        : { questions: [], answers: [], detailed: null };
}

export async function getAttemptFullDetailsAction(attemptId: string): Promise<AttemptFullDetails | null> {
    const res = await apiGet<AttemptFullDetails>(
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

export function gradeAssignmentAction(attemptId: string, score: number, feedback: string, submittedAt: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctor/attempts/${encodeURIComponent(attemptId)}/grade`,
        { score, feedback, submittedAt },
    );
}
