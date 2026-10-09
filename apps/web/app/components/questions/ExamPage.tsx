"use client";
import { getErrorMessage } from '@/lib/errors';
import { formatStudentName } from '@/lib/monitoring-health';
import { ExamPageSkeleton } from '@/app/components/ui/SkeletonPatterns';
import { useToast } from '@/app/components/ui/Toast';
import { apiSend } from '@/lib/api/client';
import { forceTerminateAttempt,heartbeatExamAttempt,logSecurityViolation } from '@/lib/api/proctoring';
import { getExamForAttempt,getExamQuestionsAction,saveAnswerAction,startExamAttemptAction,submitExamAction,syncAnswersBulkAction,type StudentExam,type StudentExamAttempt,type StudentExamQuestion,type StudentProfile } from '@/lib/api/students';
import { getDeviceId,setDeviceId } from '@/lib/device-id';
import {
createSecurityEventId,
freezeExamSnapshot,
type ExamAnswerSnapshot,
enqueueSecurityEvent,
inspectExamStorage,
readExamRecoverySession,
readExamSnapshot,
readSecurityEvents,
removeExamRecoverySession,
removeExamSnapshot,
removeExamSubmissionRegistration,
removeSecurityEvent,
resolveDurableDeviceId,
updateExamRecoveryPosition,
validateExamRecoverySession,
writeExamRecoverySession,
writeExamSnapshot,
} from '@/lib/exam-durable-storage';
import { cacheExamOfflineShell,isExamPwaEnabled,removeExamOfflineShell } from '@/lib/exam-pwa';
import { examAutoRetryDelay } from '@/lib/exam-retry';
import { ExamClock } from '@/lib/exam-clock';
import { PerKeyQueue } from '@/lib/per-key-queue';
import { getSessionUser } from '@/lib/session';
import { clearCbtSession } from '@/lib/session-reset';
import { AlertTriangle,CheckCircle2,Loader2,RefreshCw,ShieldCheck } from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { AuthUser } from '@acca-cbt/shared';
import { ExamViewer } from './ExamViewer';

function resolveMaxViolations(exam: StudentExam | null): number | null {
    if (exam?.metadata?.is_safe_mode === false) return null;
    if (exam?.metadata && Object.prototype.hasOwnProperty.call(exam.metadata, 'max_violations')) {
        const configured = exam.metadata.max_violations;
        if (configured === null) return null;
        if (typeof configured === 'number' && Number.isInteger(configured) && configured >= 1) {
            return configured;
        }
    }
    // Kompatibilitas ujian lama yang dibuat sebelum pengaturan ini tersedia.
    return 3;
}

// Tipe yang jawabannya disimpan di kolom essay_answer (JSON/teks), bukan
// selected_option_id. WAJIB sama dengan daftar di submitExamAction — dulu
// handleAnswerSelect memakai daftar lebih pendek (tanpa likert/checklist/
// ranking/ordering) sehingga auto-save tipe tersebut menulis JSON ke kolom
// uuid dan gagal diam-diam; jawaban baru terekam saat submit saja.
const COMPLEX_TYPES = ['essay', 'esay', 'uraian', 'mcq_complex', 'true_false', 'categorization', 'matching', 'short_answer', 'likert', 'checklist', 'ranking', 'ordering'];

/** Petakan satu jawaban ke kolom cbt_answers yang benar untuk tipe soalnya. */
function answerColumns(question: StudentExamQuestion | undefined, ansVal: string | undefined, isDoubtful: boolean, revision?: number) {
    const isComplex = question ? COMPLEX_TYPES.includes(question.type) : false;
    return {
        selected_option_id: isComplex ? undefined : (ansVal || undefined),
        essay_answer: isComplex ? (ansVal || undefined) : undefined,
        is_doubtful: isDoubtful,
        revision,
    };
}

/** Bentuk baris untuk sinkronisasi jawaban massal. */
function answerRow(question: StudentExamQuestion | undefined, questionId: string, ansVal: string | undefined, isDoubtful: boolean, revision?: number) {
    return { questionId, ...answerColumns(question, ansVal, isDoubtful, revision) };
}

export default function ExamPage() {
    const params = useParams();
    const router = useRouter();
    const examId = params.id as string;

    // Core State
    const [user, setUser] = useState<AuthUser | null>(null);
    // Student identity for the exam header. The auth user only carries an email;
    // the real full_name + NISN (identity_number) live in cbt_profiles.
    const [profile, setProfile] = useState<StudentProfile | null>(null);
    const [exam, setExam] = useState<StudentExam | null>(null);
    const maxViolations = resolveMaxViolations(exam);
    const [isCompleted, setIsCompleted] = useState(false);
    const [questions, setQuestions] = useState<StudentExamQuestion[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [doubtfulAnswers, setDoubtfulAnswers] = useState<Set<string>>(new Set());
    const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    // Cermin ref dari state jawaban. Interval retry, handler `pagehide`, dan
    // flush sebelum force-logout berjalan di luar siklus render, jadi mereka
    // tidak boleh membaca closure state yang bisa basi.
    const revisionsRef = useRef<Record<string, number>>({});
    const clockRef = useRef(new ExamClock());
    const answersRef = useRef<Record<string, string>>({});
    const doubtfulRef = useRef<Set<string>>(new Set());
    const questionsRef = useRef<StudentExamQuestion[]>([]);
    const attemptRef = useRef<StudentExamAttempt | null>(null);
    // Soal yang autosave-nya GAGAL terkirim, dan yang requestnya masih terbang.
    // Dulu kegagalan ditelan diam-diam (`.catch(() => {})`): centang terakhir
    // pada PGK bisa tidak pernah sampai ke server, dan jalur penutupan yang
    // menilai dari DB (pelanggaran, force-submit proktor, kedaluwarsa) memakai
    // data tertinggal itu — "centang 3, terekam 2".
    const failedSyncRef = useRef<Set<string>>(new Set());
    const inFlightRef = useRef<Set<string>>(new Set());
    const saveQueueRef = useRef(new PerKeyQueue());
    const [failedSyncCount, setFailedSyncCount] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [timeLeft, setTimeLeft] = useState(0);
    const [attempt, setAttempt] = useState<StudentExamAttempt | null>(null);
    const [assignmentFileUrls, setAssignmentFileUrls] = useState<string[]>([]);
    const [assignmentTextNote, setAssignmentTextNote] = useState('');

    // UI State
    const [accessDenied, setAccessDenied] = useState(false);
    const [accessError, setAccessError] = useState('');

    // Offline Tolerance
    const [serverUnavailableAt, setServerUnavailableAt] = useState<string | null>(null);
    const connectionReportRef = useRef<{ at: string; remainingSeconds: number; reason: 'browser_offline' | 'server_unreachable' } | null>(null);
    const connectionAttemptRef = useRef<string | null>(null);
    const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
    const [waitingForSyncAndSubmit, setWaitingForSyncAndSubmit] = useState(false);
    const [recoverySummary, setRecoverySummary] = useState<{
        localCount: number;
        serverCount: number;
        recoveryUntil: string;
    } | null>(null);
    const storageStateRef = useRef<'healthy' | 'fallback' | 'unavailable' | 'unknown'>('unknown');
    const [storageWarning, setStorageWarning] = useState<string | null>(null);

    // Security
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [violationCount, setViolationCount] = useState(0);
    const [showViolationModal, setShowViolationModal] = useState(false);
    const [violationType, setViolationType] = useState('');
    const [terminationPending, setTerminationPending] = useState<string | null>(null);
    const savedViolationsRef = useRef<Set<string>>(new Set());
    const violationCountRef = useRef(0);
    const terminationInFlightRef = useRef(false);
    const terminationReasonRef = useRef<string | null>(null);
    // Prevents concurrent / repeated submits (manual double-click, auto-submit retry loop).
    const submitInFlightRef = useRef(false);
    const frozenSnapshotRef = useRef<ExamAnswerSnapshot | null>(null);
    const [submissionOnly, setSubmissionOnly] = useState(false);
    const pendingAssignmentRef = useRef<{ documentUrl?: string; videoUrl?: string } | undefined>(undefined);
    const autoRetryCountRef = useRef(0);
    const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSubmitExamRef = useRef<(
        assignmentSubmission?: { documentUrl?: string; videoUrl?: string },
        opts?: { isAuto?: boolean },
    ) => Promise<void>>(async () => undefined);
    const autoSubmittedRef = useRef(false);
    // Absolute deadline (ms epoch) for the attempt, anchored to the server's
    // remaining time at load. The countdown is derived from this so that
    // backgrounding/throttling the tab cannot "pause" the timer to gain time.
    const deadlineRef = useRef<number | null>(null);
    // True bila halaman dibuka dari paket IndexedDB karena server tidak dapat
    // dijangkau. Autosave dan heartbeat menunggu validasi endpoint start.
    // Pengumpulan salinan terkunci diverifikasi langsung oleh endpoint submit.
    const offlineRecoveryRef = useRef(false);
    const [usingOfflineRecovery, setUsingOfflineRecovery] = useState(false);
    const toast = useToast();

    // ── Sinkronisasi ref ──────────────────────────────────────
    useEffect(() => { answersRef.current = answers; }, [answers]);
    useEffect(() => { doubtfulRef.current = doubtfulAnswers; }, [doubtfulAnswers]);
    useEffect(() => { questionsRef.current = questions; }, [questions]);
    useEffect(() => { attemptRef.current = attempt; }, [attempt]);
    useEffect(() => { violationCountRef.current = violationCount; }, [violationCount]);

    // ── Live exam question update polling ─────────────────────
    useEffect(() => {
        if (!examId || isCompleted || accessDenied || loading) return;

        const checkUpdates = async () => {
            if (!navigator.onLine || questionsRef.current.length === 0) return;
            try {
                const currentRevs: Record<string, number> = {};
                questionsRef.current.forEach(q => {
                    currentRevs[q.id] = (q as any).revision || 1;
                });

                const res = await apiSend<{
                    hasUpdates: boolean;
                    updatedQuestionIds: string[];
                    questions: StudentExamQuestion[];
                }>(
                    `/api/students/exams/${encodeURIComponent(examId)}/questions/check-updates`,
                    { revisions: currentRevs },
                    'POST',
                );

                if (res.success && res.hasUpdates && res.updatedQuestionIds?.length > 0) {
                    const updatedMap = new Map((res.questions || []).map(q => [q.id, q]));

                    // Merge into questions state
                    setQuestions(prev => {
                        const next = prev.map(q => updatedMap.get(q.id) || q);
                        questionsRef.current = next;
                        return next;
                    });

                    // Add to updatedQuestionIds for badge & red pulse indicator
                    setUpdatedQuestionIds(prev => new Set([...prev, ...res.updatedQuestionIds]));

                    // If student already answered any of these updated questions, recommend review
                    setDoubtfulAnswers(prev => {
                        const next = new Set(prev);
                        res.updatedQuestionIds.forEach(id => {
                            if (answersRef.current[id]) {
                                next.add(id);
                            }
                        });
                        doubtfulRef.current = next;
                        return next;
                    });

                    toast.warning(
                        'Pembaruan Soal Ujian',
                        `Ada ${res.updatedQuestionIds.length} butir soal yang baru saja diperbarui oleh guru. Silakan baca ulang soal tersebut.`,
                    );
                }
            } catch {
                // Ignore silent background update check errors
            }
        };

        const timer = setInterval(checkUpdates, 15000);
        return () => clearInterval(timer);
    }, [examId, isCompleted, accessDenied, loading, toast]);

    /** Tandai/lepas tanda "gagal tersimpan" untuk satu soal. */
    const markFailed = useCallback((questionId: string, failed: boolean) => {
        const set = failedSyncRef.current;
        if (failed) set.add(questionId); else set.delete(questionId);
        setFailedSyncCount(set.size);
    }, []);

    /** Soal yang jawabannya belum pasti sampai di server (gagal atau masih terbang). */
    const collectPendingRows = useCallback(() => {
        const ids = new Set<string>([...failedSyncRef.current, ...inFlightRef.current]);
        return Array.from(ids).map(qId => answerRow(
            questionsRef.current.find((question) => question.id === qId),
            qId,
            answersRef.current[qId],
            doubtfulRef.current.has(qId),
            revisionsRef.current[qId] ?? 0,
        ));
    }, []);

    /**
     * Kirim ulang jawaban yang autosave-nya gagal. Dipanggil berkala (15 detik)
     * dan sebelum attempt ditutup paksa, supaya kegagalan sesaat — token
     * Supabase kedaluwarsa di tengah ujian panjang, 500 sekejap — tidak
     * menyisakan jawaban setengah jadi di DB.
     */
    const retryFailedAnswers = useCallback(async () => {
        const att = attemptRef.current;
        if (!att?.id || failedSyncRef.current.size === 0 || frozenSnapshotRef.current) return;
        if (offlineRecoveryRef.current || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

        const ids = Array.from(failedSyncRef.current);
        const sentRevisions = { ...revisionsRef.current };
        const rows = ids.map(qId => answerRow(
            questionsRef.current.find((question) => question.id === qId),
            qId,
            answersRef.current[qId],
            doubtfulRef.current.has(qId),
            revisionsRef.current[qId] ?? 0,
        ));
        try {
            const res = await syncAnswersBulkAction(att.id, rows);
            if (res?.success) {
                ids.forEach(id => {
                    if (revisionsRef.current[id] === sentRevisions[id]) failedSyncRef.current.delete(id);
                });
                setFailedSyncCount(failedSyncRef.current.size);
            }
        } catch {
            // Biarkan tetap tertandai — percobaan berikutnya menyusul.
        }
    }, []);

    /**
     * Titipkan jawaban yang belum pasti tersimpan lewat sendBeacon. Dipakai saat
     * tab ditutup dan tepat sebelum reload paksa akibat pelanggaran, dua momen
     * yang membatalkan semua server action yang masih mengantre.
     */
    const beaconPendingAnswers = useCallback(() => {
        const att = attemptRef.current;
        if (!att?.id || frozenSnapshotRef.current) return;
        const rows = collectPendingRows();
        if (rows.length === 0) return;
        try {
            const blob = new Blob(
                [JSON.stringify({ attemptId: att.id, answers: rows, deviceId: getDeviceId() })],
                { type: 'application/json' }
            );
            navigator.sendBeacon?.('/api/exam/answers/flush', blob);
        } catch {
            // Beacon bersifat best-effort.
        }
    }, [collectPendingRows]);

    // ── Fetch exam data ───────────────────────────────────────
    useEffect(() => {
        if (!examId) return;
        async function fetchExamData() {
            setLoading(true);
            setAccessDenied(false);
            setRecoverySummary(null);
            setStorageWarning(null);
            try {
                // Penyimpanan dan ID perangkat harus siap sebelum jaringan
                // diperiksa, karena keduanya juga menjadi pagar pemulihan
                // ketika seluruh endpoint sedang tidak dapat dijangkau.
                const storageHealth = await inspectExamStorage();
                storageStateRef.current = !storageHealth.available ? 'unavailable' : storageHealth.mode === 'localstorage' ? 'fallback' : 'healthy';
                if (!storageHealth.available) {
                    setAccessDenied(true);
                    setAccessError(storageHealth.warning || 'Penyimpanan jawaban tidak tersedia.');
                    setLoading(false);
                    return;
                }
                setStorageWarning(storageHealth.warning || null);
                const durableDeviceId = await resolveDurableDeviceId(getDeviceId());
                setDeviceId(durableDeviceId);

                const restoreOfflineSession = async (knownUserId?: string | null): Promise<boolean> => {
                    let cached;
                    try {
                        cached = await readExamRecoverySession(examId);
                    } catch {
                        return false;
                    }
                    const checked = validateExamRecoverySession(cached, {
                        examId,
                        deviceId: durableDeviceId,
                        userId: knownUserId,
                        allowExpiredForSubmission: true,
                    });
                    if (!checked.valid) {
                        if (checked.reason === 'expired') {
                            setAccessDenied(true);
                            setAccessError(
                                'Batas waktu pada sesi lokal sudah berakhir. Jawaban tetap tersimpan; ' +
                                'sambungkan internet agar status ujian dapat diverifikasi dan dikumpulkan.',
                            );
                            setLoading(false);
                            return true;
                        }
                        return false;
                    }

                    const session = checked.session;
                    const local = await readExamSnapshot(session.attemptId).catch(() => null);
                    const restoredAnswers = local?.answers || {};
                    const locked = session.deadlineAt <= Date.now() || Boolean(local?.frozenSubmission) || session.attempt.metadata?.recovery_submit_only === true;
                    if (local?.frozenSubmission) frozenSnapshotRef.current = local;
                    setSubmissionOnly(locked);
                    if (locked) setWaitingForSyncAndSubmit(true);
                    answersRef.current = restoredAnswers;
                    revisionsRef.current = { ...(local?.revisions || {}) };
                    try {
                        const assignment = local?.assignmentData || JSON.parse(localStorage.getItem(`exam_assignment_${session.attemptId}`) || '{}');
                        if (Array.isArray(assignment.fileUrls)) setAssignmentFileUrls(assignment.fileUrls);
                        setAssignmentTextNote(assignment.textSubmission || assignment.textNote || '');
                        pendingAssignmentRef.current = { documentUrl: assignment.documentUrl, videoUrl: assignment.videoUrl };
                    } catch { /* The frozen answer snapshot remains usable without optional attachments. */ }
                    const restoredDoubtful = new Set(local?.doubtfulAnswers || []);
                    const restoredQuestions = session.questions;
                    const remaining = Math.max(0, Math.floor((session.deadlineAt - Date.now()) / 1000));

                    offlineRecoveryRef.current = true;
                    setUsingOfflineRecovery(true);
                    setIsOffline(true);
                    setUser(session.user);
                    setProfile(session.profile);
                    setExam(session.exam);
                    setQuestions(restoredQuestions);
                    setAttempt(session.attempt);
                    attemptRef.current = session.attempt;
                    setViolationCount(Number(session.attempt.warning_count || 0));
                    setAnswers(restoredAnswers);
                    setDoubtfulAnswers(restoredDoubtful);
                    Object.keys(restoredAnswers).forEach(id => failedSyncRef.current.add(id));
                    setFailedSyncCount(failedSyncRef.current.size);
                    deadlineRef.current = session.deadlineAt;
                    clockRef.current.anchor(remaining);
                    setTimeLeft(remaining);
                    setCurrentQIndex(Math.min(
                        Math.max(0, session.lastQuestionIndex),
                        Math.max(0, restoredQuestions.length - 1),
                    ));
                    setStorageWarning(
                        'Ujian dipulihkan dari perangkat ini. Akses server akan diverifikasi sebelum jawaban dikirim.',
                    );
                    setLoading(false);
                    return true;
                };

                const authUser = await getSessionUser();
                if (authUser) setUser(authUser);
                if (!authUser && !navigator.onLine && await restoreOfflineSession(null)) return;

                // Keterangan ujian dan identitas peserta datang bersama dalam
                // satu permintaan. Kepala layar menampilkan "Nama • NISN", jadi
                // profilnya memang dibutuhkan di sini — dan mengambil keduanya
                // sekaligus menghemat satu putaran jaringan di awal ujian.
                const detail = await getExamForAttempt(examId);

                if (!detail.success) {
                    if (detail.retryable && await restoreOfflineSession(authUser?.id)) return;
                    setAccessDenied(true);
                    setAccessError(
                        !authUser && !detail.retryable
                            ? 'Silakan login terlebih dahulu.'
                            : detail.error || 'Ujian tidak ditemukan.',
                    );
                    setLoading(false);
                    return;
                }

                if (!authUser) {
                    setAccessDenied(true);
                    setAccessError('Identitas siswa belum dapat diverifikasi. Silakan muat ulang halaman.');
                    setLoading(false);
                    return;
                }

                if (detail.profile) setProfile(detail.profile);

                const examData = detail.exam;
                setExam(examData);

                // Get questions from the bank — WAJIB lewat server action.
                // Query langsung dari browser (anon key) membuat RLS bisa
                // memblokir embed opsi secara diam-diam → "soal tanpa opsi".
                let loadedQuestions: StudentExamQuestion[] = [];
                // Endpoint backend menyatukan `question_bank_id` dan seluruh
                // `cbt_exam_question_sources`; browser tidak boleh menebak
                // sumber hanya dari kolom bank langsung.
                const qRes = await getExamQuestionsAction(examId);
                if (!qRes.success) {
                    if (qRes.retryable && await restoreOfflineSession(authUser.id)) return;
                    console.error('[ExamPage] Failed to load questions:', qRes.error);
                    setAccessDenied(true);
                    setAccessError(qRes.error || 'Gagal memuat soal. Silakan muat ulang halaman.');
                    setLoading(false);
                    return;
                }
                const qData = qRes.questions;
                if (qData && qData.length > 0) {
                    const deduplicatedData = qData.map((question) => ({
                        ...question,
                        // Dedup berdasarkan ID, bukan teks. Dedup teks dulu
                        // MENYEMBUNYIKAN opsi yang kebetulan berbunyi sama
                        // dari siswa, padahal grading tetap menghitungnya —
                        // kunci yang tersembunyi jadi mustahil dicentang.
                        bank_question_options: (() => {
                            const opts = question.bank_question_options || [];
                            const seen = new Set<string>();
                            return opts.filter((option) => {
                                if (!option.id) return true;
                                if (seen.has(option.id)) return false;
                                seen.add(option.id);
                                return true;
                            });
                        })().sort((a, b) => (a.order || 0) - (b.order || 0)),
                    }));
                    loadedQuestions = deduplicatedData;
                    setQuestions(deduplicatedData);
                } else if (examData.exam_type !== 'assignment') {
                    setAccessDenied(true);
                    setAccessError('Bank soal belum tersedia untuk ujian ini.');
                    setLoading(false);
                    return;
                }

                // Start or resume attempt (bound to this device — see device lock)
                const startRequestedAt = performance.now();
                const result = await startExamAttemptAction(examId, durableDeviceId);
                clockRef.current.anchor(Math.max(0, (result.success ? result.remainingSeconds : 0) - (performance.now() - startRequestedAt) / 1000));
                if (!result.success) {
                    if (result.retryable && await restoreOfflineSession(authUser.id)) return;
                    const pendingSession = await readExamRecoverySession(examId).catch(() => null);
                    if (result.expiredAttemptId && pendingSession?.attemptId === result.expiredAttemptId &&
                        pendingSession.deadlineAt <= Date.now() && await restoreOfflineSession(authUser.id)) return;
                    // Penolakan eksplisit server (selesai, kedaluwarsa, dicabut,
                    // atau perangkat berbeda) mengalahkan paket lama. Snapshot
                    // jawaban tetap dipertahankan untuk pemulihan proktor.
                    await removeExamRecoverySession(examId).catch(() => undefined);
                    await removeExamOfflineShell(examId).catch(() => undefined);
                    const expiredId = 'expiredAttemptId' in result ? result.expiredAttemptId : undefined;
                    let localCount = 0;
                    if (expiredId) {
                        const cached = await readExamSnapshot(expiredId);
                        localCount = Object.keys(cached?.answers || {}).length;
                    }
                    setAccessDenied(true);
                    setAccessError(
                        (result.error || 'Tidak bisa mengakses ujian ini.') +
                        (expiredId
                            ? ` ${localCount} jawaban tersimpan di perangkat ini. ` +
                              'Hubungi proktor untuk membuka pemulihan; jangan hapus data browser atau berpindah perangkat.'
                            : ''),
                    );
                    setLoading(false);
                    return;
                }

                const makeupActivatedAt = result.attempt.metadata?.makeup_activated_at;
                if (typeof makeupActivatedAt === 'string') {
                    const previousSession = await readExamRecoverySession(examId);
                    if (previousSession?.attempt.metadata?.makeup_activated_at !== makeupActivatedAt) {
                        await removeExamSnapshot(result.attempt.id);
                        for (const event of await readSecurityEvents(result.attempt.id)) {
                            await removeSecurityEvent(result.attempt.id, event.id);
                        }
                        failedSyncRef.current.clear();
                        try {
                            localStorage.removeItem(`exam_assignment_${result.attempt.id}`);
                            localStorage.removeItem(`exam_lastseen_${result.attempt.id}`);
                        } catch { /* Penyimpanan browser dapat dinonaktifkan. */ }
                    }
                }
                setAttempt(result.attempt);
                attemptRef.current = result.attempt;
                const recoverySubmitOnly = result.attempt.metadata?.recovery_submit_only === true;
                setSubmissionOnly(recoverySubmitOnly);
                // Lanjutkan hitungan pelanggaran dari DB — kalau mulai dari 0
                // lagi setiap reload, siswa dapat "jatah" 3 pelanggaran baru
                // sementara warning_count di server terus terakumulasi (angka
                // monitoring bisa 4/3, 5/3).
                setViolationCount(result.attempt.warning_count || 0);

                // Deteksi close-tab: sessionStorage bertahan saat reload tapi
                // kosong di tab/sesi baru. Kalau attempt in_progress dibuka di
                // tab baru dan ada jejak heartbeat sebelumnya, berarti tab
                // ujian sempat ditutup — catat 'tab_close' + lama di luar.
                const sessionKey = `exam_session_${result.attempt.id}`;
                const lastSeenKey = `exam_lastseen_${result.attempt.id}`;
                try {
                    if (result.attempt.status === 'in_progress' && !sessionStorage.getItem(sessionKey)) {
                        const lastSeen = Number(localStorage.getItem(lastSeenKey) || 0);
                        if (lastSeen > 0) {
                            const createdAt = new Date().toISOString();
                            void enqueueSecurityEvent({
                                id: createSecurityEventId(),
                                attemptId: result.attempt.id,
                                eventType: 'tab_close',
                                metadata: {
                                    timestamp: createdAt,
                                    duration_seconds: Math.max(0, Math.round((Date.now() - lastSeen) / 1000)),
                                },
                                createdAt,
                            });
                        }
                    }
                    sessionStorage.setItem(sessionKey, '1');
                } catch {
                    // Browser dapat menolak Web Storage (mode privat/kebijakan
                    // perangkat). Itu tidak boleh menggagalkan pembukaan ujian.
                }

                // Pulihkan jawaban server lalu timpa dengan snapshot lokal yang
                // lebih baru. Helper juga memigrasikan cache localStorage lama.
                const savedA: Record<string, string> = {};
                const savedD = new Set<string>();
                let localAnswerIds: string[] = [];
                const serverAnswerIds = new Set<string>();
                (result.answers || []).forEach((ans) => {
                    serverAnswerIds.add(ans.question_id);
                    revisionsRef.current[ans.question_id] = ans.metadata?.answer_revision ?? 0;
                    savedA[ans.question_id] = ans.selected_option_id ?? ans.essay_answer ?? '';
                    if (ans.is_doubtful) savedD.add(ans.question_id);
                });

                try {
                    const parsed = await readExamSnapshot(result.attempt.id);
                    if (parsed) {
                        if (parsed.frozenSubmission) { frozenSnapshotRef.current = parsed; setSubmissionOnly(true); setWaitingForSyncAndSubmit(true); }
                        if (parsed.answers) {
                            localAnswerIds = Object.keys(parsed.answers)
                                .filter(qId => loadedQuestions.some((question) => question.id === qId));
                            localAnswerIds = localAnswerIds.filter(qId => {
                                const localRevision = parsed.revisions?.[qId] ?? 0;
                                const serverRevision = revisionsRef.current[qId] ?? 0;
                                // Old caches cannot overwrite a versioned server answer.
                                if (localRevision < serverRevision) return false;
                                if (localRevision === serverRevision && serverRevision > 0 &&
                                    serverAnswerIds.has(qId) && (savedA[qId] !== parsed.answers[qId] ||
                                        savedD.has(qId) !== parsed.doubtfulAnswers.includes(qId))) return false;
                                savedA[qId] = parsed.answers[qId];
                                revisionsRef.current[qId] = localRevision;
                                if (parsed.doubtfulAnswers.includes(qId)) savedD.add(qId); else savedD.delete(qId);
                                return true;
                            });
                        }
                    }
                } catch(e) {
                    console.error('Failed to read local answers', e);
                }

                // Lampiran tugas hanya hidup di state React sampai submit —
                // reload di tengah pengerjaan membuat file yang sudah terunggah
                // tidak ikut terkirim. Pulihkan dari localStorage.
                try {
                    const assignmentLocal = localStorage.getItem(`exam_assignment_${result.attempt.id}`);
                    if (assignmentLocal) {
                        const parsed = JSON.parse(assignmentLocal);
                        if (Array.isArray(parsed.fileUrls)) setAssignmentFileUrls(parsed.fileUrls);
                        if (typeof parsed.textNote === 'string') setAssignmentTextNote(parsed.textNote);
                    }
                } catch (e) { console.error('Failed to parse local assignment data', e); }

                answersRef.current = savedA;
                doubtfulRef.current = savedD;
                setAnswers(savedA);
                setDoubtfulAnswers(savedD);
                await writeExamSnapshot(result.attempt.id, {
                    answers: savedA, doubtfulAnswers: Array.from(savedD), revisions: { ...revisionsRef.current },
                });

                const recoveryUntil = result.attempt.metadata?.proctor_recovery_until;
                if (
                    typeof recoveryUntil === 'string' &&
                    new Date(recoveryUntil).getTime() > Date.now()
                ) {
                    setRecoverySummary({
                        localCount: localAnswerIds.length,
                        serverCount: serverAnswerIds.size,
                        recoveryUntil,
                    });
                }

                // Setelah proktor mereset attempt, statusnya kembali in_progress.
                // Pada titik inilah salinan lokal boleh dipulihkan melalui jalur
                // biasa yang memeriksa perangkat dan batas waktu di server.
                if (localAnswerIds.length > 0 && navigator.onLine && !recoverySubmitOnly && !frozenSnapshotRef.current) {
                    const rows = localAnswerIds.map(qId => answerRow(
                        loadedQuestions.find((question) => question.id === qId),
                        qId,
                        savedA[qId],
                        savedD.has(qId),
                        revisionsRef.current[qId] ?? 0,
                    ));
                    try {
                        const sync = await syncAnswersBulkAction(result.attempt.id, rows);
                        if (sync?.success) {
                            localAnswerIds.forEach(id => failedSyncRef.current.delete(id));
                            setRecoverySummary(current => current ? {
                                ...current,
                                serverCount: new Set([...serverAnswerIds, ...localAnswerIds]).size,
                            } : current);
                        } else {
                            localAnswerIds.forEach(id => failedSyncRef.current.add(id));
                        }
                    } catch {
                        localAnswerIds.forEach(id => failedSyncRef.current.add(id));
                    }
                    setFailedSyncCount(failedSyncRef.current.size);
                }

                // Timer from server-calculated remaining seconds. Anchor an
                // absolute deadline so the countdown reflects real elapsed time
                // even if the tab was backgrounded (timer throttling can't grant
                // extra time).
                const remaining = clockRef.current.remainingSeconds();
                deadlineRef.current = Date.now() + remaining * 1000;
                setTimeLeft(remaining);

                // Tulis paket hanya setelah semua pemeriksaan server berhasil.
                // Jika langkah ini gagal, ujian tetap boleh berjalan karena
                // snapshot jawaban masih tersedia; hanya pemulihan reload penuh
                // yang tidak dapat dijamin.
                try {
                    await writeExamRecoverySession({
                        examId,
                        attemptId: result.attempt.id,
                        userId: authUser.id,
                        deviceId: durableDeviceId,
                        user: authUser,
                        profile: detail.profile || null,
                        exam: examData,
                        attempt: result.attempt,
                        questions: loadedQuestions,
                        deadlineAt: deadlineRef.current,
                        lastQuestionIndex: 0,
                    });
                    const shellCached = await cacheExamOfflineShell(examId);
                    if (isExamPwaEnabled() && !shellCached) {
                        setStorageWarning(
                            'Data jawaban tersimpan, tetapi halaman offline belum selesai disiapkan. Jangan tutup browser saat jaringan terputus.',
                        );
                    }
                } catch {
                    setStorageWarning(
                        'Paket pemulihan offline tidak dapat disimpan. Jangan memuat ulang halaman saat jaringan terputus.',
                    );
                }
            } catch (err) {
                console.error("[ExamPage] Error fetching exam:", err);
                setAccessDenied(true);
                setAccessError(getErrorMessage(err) || 'Terjadi kesalahan saat memuat ujian.');
            }
            setLoading(false);
        }
        fetchExamData();
    }, [examId]);

    // Simpan lampiran/catatan tugas per attempt agar tahan reload.
    useEffect(() => {
        if (!attempt?.id) return;
        try {
            localStorage.setItem(
                `exam_assignment_${attempt.id}`,
                JSON.stringify({ fileUrls: assignmentFileUrls, textNote: assignmentTextNote })
            );
        } catch { /* storage penuh / mode privat — abaikan */ }
    }, [attempt?.id, assignmentFileUrls, assignmentTextNote]);

    // Ingat nomor terakhir agar reload offline kembali ke posisi yang sama.
    // Sedikit debounce menghindari penulisan beruntun saat siswa menekan tombol
    // navigasi dengan cepat.
    useEffect(() => {
        if (!attempt?.id || isCompleted) return;
        const timer = setTimeout(() => {
            void updateExamRecoveryPosition(examId, currentQIndex).catch(() => undefined);
        }, 200);
        return () => clearTimeout(timer);
    }, [examId, attempt?.id, currentQIndex, isCompleted]);

    // Semua pengumpulan dicoba ulang sampai server mengonfirmasi status final.
    // Backoff berhenti naik pada 30 detik dan hanya satu timer boleh aktif.
    // Server idempoten, jadi respons sukses yang hilang aman untuk diulang.
    const scheduleAutoRetry = useCallback(() => {
        if (autoRetryTimerRef.current) return;
        const delay = examAutoRetryDelay(autoRetryCountRef.current);
        autoRetryCountRef.current += 1;
        autoRetryTimerRef.current = setTimeout(() => {
            autoRetryTimerRef.current = null;
            if (!submitInFlightRef.current) handleSubmitExamRef.current(undefined, { isAuto: true });
        }, delay);
    }, []);

    const handleSubmitExam = useCallback(async (assignmentSubmission?: { documentUrl?: string, videoUrl?: string }, opts?: { isAuto?: boolean }) => {
        // Ref-based guard (not the async `submitting` state) so a second call in the same
        // tick — or an auto-submit retry after a failure — can't slip through.
        if (!user || submitInFlightRef.current || terminationReasonRef.current) return;

        const isAssignment = exam?.exam_type === 'assignment';
        if (assignmentSubmission) pendingAssignmentRef.current = assignmentSubmission;

        const activeAttempt = attemptRef.current;
        if (!activeAttempt) return;
        if (!frozenSnapshotRef.current) {
            frozenSnapshotRef.current = {
                answers: { ...answersRef.current }, revisions: { ...revisionsRef.current },
                doubtfulAnswers: Array.from(doubtfulRef.current),
                ...(activeAttempt.started_at && activeAttempt.personal_end_time ? {
                    frozenSubmission: { startedAt: activeAttempt.started_at, personalEndTime: activeAttempt.personal_end_time },
                } : {}),
                assignmentData: isAssignment ? {
                    ...pendingAssignmentRef.current, fileUrls: [...assignmentFileUrls], textSubmission: assignmentTextNote,
                } : undefined,
            };
        }
        setSubmissionOnly(true);
        submitInFlightRef.current = true;
        try {
            frozenSnapshotRef.current = await freezeExamSnapshot(activeAttempt.id, frozenSnapshotRef.current);
        } catch (error) {
            setStorageWarning(getErrorMessage(error));
        }
        const snapshot = frozenSnapshotRef.current;
        if (!navigator.onLine) {
            submitInFlightRef.current = false;
            setWaitingForSyncAndSubmit(true);
            return;
        }
        // This submission endpoint validates owner, device and attempt generation itself.
        offlineRecoveryRef.current = false;
        if (autoRetryTimerRef.current) {
            clearTimeout(autoRetryTimerRef.current);
            autoRetryTimerRef.current = null;
        }
        setSubmitting(true);

        try {
            // Retry the same frozen payload; the server validates its attempt and device.
            const result = await submitExamAction(
                examId,
                snapshot.answers,
                snapshot.assignmentData,
                activeAttempt.id,
                snapshot.revisions,
                snapshot.frozenSubmission,
            );
            if (result.success) {
                autoRetryCountRef.current = 0;
                setIsCompleted(true);
                if (result.savedAnswersOnly) {
                    toast.warning('Waktu ujian berakhir', 'Hanya jawaban yang sudah sampai di server dinilai. Salinan lokal dipertahankan untuk pemulihan dengan persetujuan proktor.');
                } else if (result.gradingPending) {
                    toast.success('Jawaban berhasil dikumpulkan', 'Penilaian sedang menunggu layanan tersedia. Jawaban sudah aman di server.');
                } else {
                    toast.success(isAssignment ? 'Tugas berhasil dikumpulkan!' : 'Ujian berhasil disubmit!');
                }
                if (attempt?.id && !result.savedAnswersOnly) {
                    await removeExamSnapshot(attempt.id);
                    await removeExamSubmissionRegistration(attempt.id, activeAttempt.started_at, activeAttempt.personal_end_time);
                    try {
                        localStorage.removeItem(`exam_assignment_${attempt.id}`);
                    } catch { /* Server has confirmed the commit; cache cleanup must not change its outcome. */ }
                }
                await removeExamRecoverySession(examId).catch(() => undefined);
                await removeExamOfflineShell(examId).catch(() => undefined);
                router.push('/dashboard/siswa/results');
                // keep submitInFlightRef = true so nothing re-submits after success
            } else {
                if (result.retryable === false) {
                    setSubmitting(false);
                    submitInFlightRef.current = false;
                    setWaitingForSyncAndSubmit(false);
                    setAccessDenied(true);
                    setAccessError((result.error || 'Pengumpulan ditolak.') + ' Salinan jawaban tetap tersimpan di perangkat ini.');
                    return;
                }
                if (!opts?.isAuto || autoRetryCountRef.current === 0) {
                    toast.error(isAssignment ? 'Gagal mengumpulkan tugas' : 'Gagal submit ujian', result.error || 'Terjadi kesalahan');
                }
                setSubmitting(false);
                setWaitingForSyncAndSubmit(true);
                submitInFlightRef.current = false;
                scheduleAutoRetry();
            }
        } catch (err) {
            if (!opts?.isAuto || autoRetryCountRef.current === 0) {
                toast.error('Gagal submit ujian', getErrorMessage(err) || 'Terjadi kesalahan');
            }
            setSubmitting(false);
            setWaitingForSyncAndSubmit(true);
            submitInFlightRef.current = false;
            scheduleAutoRetry();
        }
    }, [user, examId, exam, assignmentFileUrls, assignmentTextNote, router, toast, attempt, scheduleAutoRetry]);

    // Simpan referensi terbaru agar retry terjadwal selalu memanggil versi
    // dengan closure `answers` termutakhir (bukan snapshot saat gagal).
    useEffect(() => {
        handleSubmitExamRef.current = handleSubmitExam;
    }, [handleSubmitExam]);

    useEffect(() => () => {
        if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
    }, []);

    const syncPendingAnswers = useCallback(async (): Promise<boolean> => {
        const att = attemptRef.current;
        if (!att?.id || offlineRecoveryRef.current) return false;
        try {
            const parsed = await readExamSnapshot(att.id);
            if (parsed) {
                const answersArray = Object.keys(parsed.answers || {})
                    .filter(qId => questionsRef.current.some((question) => question.id === qId))
                    .map(qId => answerRow(
                        questionsRef.current.find((question) => question.id === qId),
                        qId,
                        parsed.answers[qId],
                        parsed.doubtfulAnswers ? parsed.doubtfulAnswers.includes(qId) : false,
                        parsed.revisions?.[qId] ?? 0,
                    ));

                if (answersArray.length > 0) {
                    const hadPendingAnswers = failedSyncRef.current.size > 0;
                    const res = await syncAnswersBulkAction(att.id, answersArray);
                    if (res.success) {
                        // Seluruh snapshot durable baru saja dikirim ulang.
                        answersArray.forEach(row => {
                            if ((revisionsRef.current[row.questionId] ?? 0) === row.revision) failedSyncRef.current.delete(row.questionId);
                        });
                        setFailedSyncCount(failedSyncRef.current.size);
                        if (hadPendingAnswers) {
                            toast.success('Tersinkronisasi', 'Jawaban offline telah dikirim.');
                        }
                        return true;
                    }
                    answersArray.forEach(row => {
                        if ((revisionsRef.current[row.questionId] ?? 0) === row.revision) failedSyncRef.current.add(row.questionId);
                    });
                    setFailedSyncCount(failedSyncRef.current.size);
                    return false;
                }
            }
            return true;
        } catch(e) {
            console.error('Failed to sync answers', e);
            return false;
        }
    }, [toast]);

    /**
     * Paket offline hanya memberi hak untuk tetap mengerjakan sampai deadline
     * yang telah disahkan. Begitu jaringan kembali, server harus mengakui
     * attempt yang sama sebelum satu pun jawaban, heartbeat, atau submit keluar.
     */
    const revalidateOfflineSession = useCallback(async (): Promise<boolean> => {
        if (frozenSnapshotRef.current || submissionOnly || clockRef.current.remainingSeconds() <= 0) return true;
        if (!offlineRecoveryRef.current) return true;
        const localAttempt = attemptRef.current;
        if (!localAttempt?.id || !navigator.onLine) return false;

        const startRequestedAt = performance.now();
        const result = await startExamAttemptAction(examId, getDeviceId());
        if (!result.success) {
            if (result.retryable) {
                setIsOffline(true);
                return false;
            }
            await removeExamRecoverySession(examId).catch(() => undefined);
            await removeExamOfflineShell(examId).catch(() => undefined);
            setAccessDenied(true);
            setAccessError(
                `${result.error || 'Sesi ujian tidak lagi aktif.'} ` +
                'Jawaban lokal tetap tersimpan. Hubungi proktor bila perlu pemulihan.',
            );
            return false;
        }
        if (result.attempt?.id !== localAttempt.id) {
            await removeExamRecoverySession(examId).catch(() => undefined);
            await removeExamOfflineShell(examId).catch(() => undefined);
            setAccessDenied(true);
            setAccessError('Sesi yang diverifikasi server berbeda dari sesi lokal. Jawaban tidak dikirim untuk mencegah tertukar.');
            return false;
        }

        const remaining = Math.max(0, (result.remainingSeconds || 0) - (performance.now() - startRequestedAt) / 1000);
        clockRef.current.anchor(remaining);
        const serverDeadline = Date.now() + remaining * 1000;
        deadlineRef.current = serverDeadline;
        setTimeLeft(remaining);
        setAttempt(result.attempt);
        setViolationCount(Number(result.attempt.warning_count || 0));
        offlineRecoveryRef.current = false;
        setUsingOfflineRecovery(false);
        setIsOffline(false);

        try {
            const cached = await readExamRecoverySession(examId);
            if (cached) {
                await writeExamRecoverySession({
                    ...cached,
                    attempt: result.attempt,
                    deadlineAt: serverDeadline,
                    cachedAt: new Date().toISOString(),
                });
            }
        } catch {
            // Validasi server sudah berhasil; kegagalan menyegarkan cache tidak
            // boleh membatalkan sinkronisasi jawaban yang sedang menunggu.
        }
        return true;
    }, [examId, submissionOnly]);

    /** Tutup UI hanya setelah server benar-benar mengonfirmasi terminasi. */
    const confirmPendingTermination = useCallback(async (reason: string): Promise<boolean> => {
        const att = attemptRef.current;
        if (!att?.id || offlineRecoveryRef.current || terminationInFlightRef.current || !navigator.onLine) return false;
        terminationInFlightRef.current = true;
        try {
            await retryFailedAnswers();
            beaconPendingAnswers();
            const result = await forceTerminateAttempt(att.id, reason);
            if (!result.success) return false;

            await clearCbtSession();
            window.location.reload();
            return true;
        } catch {
            return false;
        } finally {
            terminationInFlightRef.current = false;
        }
    }, [retryFailedAnswers, beaconPendingAnswers]);

    /** Kirim antrean satu per satu; hapus hanya sesudah server mengakuinya. */
    const flushSecurityEvents = useCallback(async (): Promise<{
        warningCount: number;
        maxViolations: number | null;
        terminated: boolean;
    } | null> => {
        const att = attemptRef.current;
        if (!att?.id || offlineRecoveryRef.current || !navigator.onLine) return null;
        const events = await readSecurityEvents(att.id);
        let latest: { warningCount: number; maxViolations: number | null; terminated: boolean } | null = null;
        for (let index = 0; index < events.length; index++) {
            const event = events[index];
            const result = await logSecurityViolation(
                att.id,
                event.eventType,
                event.metadata,
                event.id,
            );
            if (!result.success) break;
            latest = {
                warningCount: result.warningCount,
                maxViolations: result.maxViolations,
                terminated: result.terminated,
            };
            await removeSecurityEvent(att.id, event.id);
            if (result.terminated) {
                // Event setelah ambang tidak lagi relevan karena attempt sudah
                // ditutup oleh server. Bersihkan agar antrean lokal tidak macet.
                await Promise.all(events.slice(index + 1).map((queued) =>
                    removeSecurityEvent(att.id, queued.id),
                ));
                break;
            }
        }
        if (latest) {
            violationCountRef.current = latest.warningCount;
            setViolationCount(latest.warningCount);
            if (latest.terminated) {
                await clearCbtSession();
                window.location.reload();
            }
        }
        return latest;
    }, []);

    const requireTermination = useCallback((reason: string) => {
        terminationReasonRef.current = reason;
        setTerminationPending(reason);
        void confirmPendingTermination(reason);
    }, [confirmPendingTermination]);

    // ── Network Detection ────────────────────────────────────
    const recordConnectionInterruption = useCallback((reason: 'browser_offline' | 'server_unreachable') => {
        const current = attemptRef.current;
        if (!current?.id) return;
        if (connectionAttemptRef.current !== current.id) {
            connectionAttemptRef.current = current.id;
            connectionReportRef.current = null;
        }
        connectionReportRef.current ||= { at: new Date().toISOString(), remainingSeconds: Math.max(0, Math.ceil(clockRef.current.remainingSeconds())), reason };
        setServerUnavailableAt(connectionReportRef.current.at);
        try { localStorage.setItem(`exam_connection_${current.id}`, JSON.stringify(connectionReportRef.current)); } catch { /* Retain the report in memory. */ }
    }, []);

    useEffect(() => {
        const handleOnline = () => {
            void (async () => {
                if (!await revalidateOfflineSession()) return;
                setIsOffline(false);
                if (!attemptRef.current?.id) return;
                if (submissionOnly || frozenSnapshotRef.current || clockRef.current.remainingSeconds() <= 0) {
                    await handleSubmitExam(undefined, { isAuto: true });
                    return;
                }
                const answersSynced = waitingForSyncAndSubmit
                    ? true
                    : await syncPendingAnswers();
                const securityResult = await flushSecurityEvents();
                if (securityResult?.terminated) return;
                if (terminationReasonRef.current) {
                    void confirmPendingTermination(terminationReasonRef.current);
                    return;
                }
                if (waitingForSyncAndSubmit && answersSynced) {
                    handleSubmitExam(undefined, { isAuto: true });
                }
            })();
        };
        const handleOffline = () => { setIsOffline(true); recordConnectionInterruption('browser_offline'); };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [recordConnectionInterruption, attempt, submissionOnly, syncPendingAnswers, flushSecurityEvents, confirmPendingTermination, waitingForSyncAndSubmit, handleSubmitExam, revalidateOfflineSession]);

    // `online` tidak selalu ditembakkan bila Wi-Fi tetap terhubung tetapi API
    // sempat mati. Paket recovery memeriksa ulang server secara berkala; setelah
    // valid, jawaban langsung disusulkan melalui jalur yang sama.
    useEffect(() => {
        if (!usingOfflineRecovery || !attempt?.id || isCompleted || accessDenied || submissionOnly) return;
        let active = true;
        const retry = async () => {
            if (!navigator.onLine) return;
            const valid = await revalidateOfflineSession();
            if (!active || !valid) return;
            await syncPendingAnswers();
            await flushSecurityEvents();
        };
        void retry();
        const interval = setInterval(() => { void retry(); }, 15_000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [usingOfflineRecovery, attempt?.id, isCompleted, accessDenied, submissionOnly, revalidateOfflineSession, syncPendingAnswers, flushSecurityEvents]);

    // Event `online` tidak selalu muncul ketika Wi-Fi tetap tersambung tetapi
    // backend sempat tidak dapat dijangkau. Selama submit menunggu, periksa ulang
    // snapshot dan server secara berkala tanpa menghapus salinan lokal.
    useEffect(() => {
        if (!waitingForSyncAndSubmit || !attempt?.id || isCompleted || accessDenied) return;
        let active = true;
        const retry = async () => {
            if (!navigator.onLine || submitInFlightRef.current) return;
            if (!await revalidateOfflineSession()) return;
            if (active && !submitInFlightRef.current) {
                await handleSubmitExam(undefined, { isAuto: true });
            }
        };
        void retry();
        const interval = setInterval(() => { void retry(); }, 15_000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [waitingForSyncAndSubmit, attempt?.id, isCompleted, accessDenied, handleSubmitExam, revalidateOfflineSession]);

    // ── Security event listeners ─────────────────────────────
    useEffect(() => {
        if (!attempt || isCompleted || loading || accessDenied || submissionOnly) return;
        if (exam?.metadata?.is_safe_mode === false) return;

        const handleSecurityViolation = async (type: string) => {
            // Cooldown GLOBAL lintas-jenis, bukan per-jenis: satu aksi pengguna
            // memicu beberapa event sekaligus (alt-tab = blur + visibilitychange,
            // pindah aplikasi bisa sekalian keluar fullscreen). Dedup per-jenis
            // membuat satu aksi terhitung 2-3 pelanggaran dan warning_count di
            // server melampaui batas maksimal.
            if (savedViolationsRef.current.has('violation:cooldown')) return;
            savedViolationsRef.current.add('violation:cooldown');
            setTimeout(() => savedViolationsRef.current.delete('violation:cooldown'), 2000);

            setViolationType(type);
            setShowViolationModal(true);
            const newCount = violationCountRef.current + 1;
            violationCountRef.current = newCount;
            setViolationCount(newCount);

            try {
                const createdAt = new Date().toISOString();
                const stored = await enqueueSecurityEvent({
                    id: createSecurityEventId(),
                    attemptId: attempt.id,
                    eventType: type,
                    metadata: { timestamp: createdAt },
                    createdAt,
                });
                if (!stored.saved) {
                    setStorageWarning('Event keamanan gagal disimpan di perangkat. Hubungi proktor.');
                }

                // Dahulukan jawaban bila event lokal ini diperkirakan mencapai
                // ambang. Server tetap menjadi penentu akhir.
                if (maxViolations !== null && newCount >= maxViolations) {
                    await retryFailedAnswers();
                    beaconPendingAnswers();
                }
                const securityResult = await flushSecurityEvents();
                if (securityResult?.terminated) return;
                const effectiveLimit = securityResult?.maxViolations ?? maxViolations;
                const effectiveCount = securityResult?.warningCount ?? newCount;
                if (effectiveLimit !== null && effectiveCount >= effectiveLimit) {
                    requireTermination(`Batas ${effectiveLimit} pelanggaran tercapai: ${type}`);
                }
            } catch (err) {
                console.error('Security violation error:', err);
                if (maxViolations !== null && newCount >= maxViolations) {
                    requireTermination(`Batas ${maxViolations} pelanggaran tercapai: ${type}`);
                }
            }
        };

        const onVisibilityChange = () => {
            if (document.hidden) handleSecurityViolation('tab_switch');
        };
        
        let blurTimeout: NodeJS.Timeout;
        const onBlur = () => {
            // Memberikan toleransi 5 detik untuk mengabaikan pop-up notifikasi OS singkat
            blurTimeout = setTimeout(() => {
                handleSecurityViolation('window_blur');
            }, 5000);
        };
        const onFocus = () => {
            // Batalkan pelanggaran jika kursor/fokus kembali dalam kurun < 5 detik
            if (blurTimeout) clearTimeout(blurTimeout);
        };

        const onFullscreenChange = () => {
            if (!document.fullscreenElement) {
                setIsFullScreen(false);
                handleSecurityViolation('exit_fullscreen');
            }
        };
        const onContextMenu = (e: MouseEvent) => e.preventDefault();
        const onKeyDown = (e: KeyboardEvent) => {
            if (
                e.key === 'PrintScreen' ||
                (e.ctrlKey && ['c', 'v', 'u', 's', 'p'].includes(e.key)) ||
                e.key === 'F12'
            ) {
                e.preventDefault();
                handleSecurityViolation('restricted_shortcut');
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            if (blurTimeout) clearTimeout(blurTimeout);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            document.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [attempt, isCompleted, loading, user, profile, exam, accessDenied, submissionOnly, examId, flushSecurityEvents, requireTermination, maxViolations, retryFailedAnswers, beaconPendingAnswers]);

    // Retry berkala untuk autosave yang gagal. Sebelumnya jawaban yang gagal
    // tersimpan hanya tersusul kalau kebetulan ada event 'online' — kegagalan
    // saat koneksi tetap menyala tidak pernah dicoba ulang sama sekali.
    useEffect(() => {
        if (!attempt?.id || isCompleted || accessDenied || submissionOnly) return;
        const iv = setInterval(() => { retryFailedAnswers(); }, 15000);
        return () => clearInterval(iv);
    }, [attempt?.id, isCompleted, accessDenied, submissionOnly, retryFailedAnswers]);

    // Tab ditutup / berpindah ke background: titipkan jawaban yang belum pasti
    // tersimpan lewat sendBeacon. Server action yang masih mengantre di klien
    // ikut mati saat halaman dibongkar, jadi beacon adalah jaring terakhir.
    useEffect(() => {
        if (!attempt?.id || isCompleted || accessDenied) return;
        const onPageHide = () => beaconPendingAnswers();
        const onHidden = () => { if (document.hidden) beaconPendingAnswers(); };
        window.addEventListener('pagehide', onPageHide);
        document.addEventListener('visibilitychange', onHidden);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            document.removeEventListener('visibilitychange', onHidden);
        };
    }, [attempt?.id, isCompleted, accessDenied, submissionOnly, beaconPendingAnswers]);

    // Heartbeat lokal mendeteksi tab yang pernah ditutup; heartbeat server
    // memberi layar pengawas status online/offline yang dapat dipercaya.
    useEffect(() => {
        if (!attempt || isCompleted || accessDenied || submissionOnly) return;
        const key = `exam_lastseen_${attempt.id}`;
        let running = false;
        let cancelled = false;
        const pulse = async () => {
            if (running || cancelled) return;
            running = true;
            try {
            if (connectionAttemptRef.current !== attempt.id) {
                connectionAttemptRef.current = attempt.id;
                connectionReportRef.current = null;
                setServerUnavailableAt(null);
            }
            if (!connectionReportRef.current) {
                try {
                    const saved = JSON.parse(localStorage.getItem(`exam_connection_${attempt.id}`) || 'null');
                    if (saved && Number.isFinite(Date.parse(saved.at)) && Number.isInteger(saved.remainingSeconds) && saved.remainingSeconds >= 0 && saved.remainingSeconds <= 604800 && ['browser_offline', 'server_unreachable'].includes(saved.reason)) connectionReportRef.current = saved;
                } catch { /* Optional local telemetry. */ }
            }
            try { localStorage.setItem(key, String(Date.now())); } catch { /* optional heartbeat */ }
            if (!navigator.onLine) { recordConnectionInterruption('browser_offline'); return; }
            if (offlineRecoveryRef.current) return;
            const report = connectionReportRef.current;
            const heartbeat = await heartbeatExamAttempt(attempt.id, {
                localAnswerCount: Object.values(answersRef.current).filter(value => value.trim().length > 0).length,
                pendingAnswerCount: new Set([...failedSyncRef.current, ...inFlightRef.current]).size,
                storageState: storageStateRef.current,
                ...(report ? { interruption: report } : {}),
            }).catch(() => undefined);
            if (cancelled) return;
            if (heartbeat?.success) {
                if (navigator.onLine && connectionReportRef.current === report) setServerUnavailableAt(null);
                if (report && connectionReportRef.current === report) {
                    connectionReportRef.current = null;
                    try { localStorage.removeItem(`exam_connection_${attempt.id}`); } catch { /* Optional telemetry. */ }
                }
            } else recordConnectionInterruption('server_unreachable');
            if (heartbeat?.success && heartbeat.submissionOnly) {
                setSubmissionOnly(true);
                return;
            }
            const securityResult = await flushSecurityEvents().catch(() => null);
            if (!securityResult?.terminated && terminationReasonRef.current) {
                void confirmPendingTermination(terminationReasonRef.current);
            }
            } finally { running = false; }
        };
        void pulse();
        const iv = setInterval(() => { void pulse(); }, 15000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [attempt, isCompleted, accessDenied, submissionOnly, flushSecurityEvents, confirmPendingTermination, recordConnectionInterruption]);

    // ── Timer ─────────────────────────────────────────────────
    useEffect(() => {
        if (loading || !exam || timeLeft <= 0 || submitting || accessDenied || isCompleted) return;
        const tick = () => {
            // Derive remaining from the absolute deadline so a throttled/background
            // tab cannot slow the countdown.
            const remaining = clockRef.current.remainingSeconds();
            setTimeLeft(remaining);
            if (remaining <= 0) clearInterval(timer);
        };
        const timer = setInterval(tick, 1000);
        // Recompute immediately on regaining focus/visibility (catches up after a
        // long background period without waiting for the next throttled tick).
        const onVisible = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
        // Note: timeLeft is intentionally NOT a dependency — the interval owns the
        // countdown and clears itself at 0, so we don't recreate it every second.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, exam, submitting, accessDenied, isCompleted]);

    // Auto-submit when timer hits 0.
    // Guards: only fire once the exam is actually loaded and running (avoids the initial
    // timeLeft=0 firing prematurely during load), never on accessDenied/completed states,
    // and only once (autoSubmittedRef) so a failed submit can't spin into a retry loop.
    useEffect(() => {
        if (loading || accessDenied || isCompleted || submitting) return;
        if (!user || !attempt) return;
        if (timeLeft !== 0) return;
        if (autoSubmittedRef.current) return;
        autoSubmittedRef.current = true;

        void handleSubmitExam(undefined, { isAuto: true });
    }, [timeLeft, isOffline, submitting, isCompleted, user, attempt, loading, accessDenied, handleSubmitExam]);



    const handleAnswerSelect = useCallback(async (questionId: string, answer: string | string[]) => {
        if (submissionOnly || frozenSnapshotRef.current || submitInFlightRef.current || clockRef.current.remainingSeconds() <= 0) return;
        const revision = (revisionsRef.current[questionId] ?? 0) + 1;
        revisionsRef.current[questionId] = revision;
        const answerStr = Array.isArray(answer) ? answer.join(',') : answer;
        // Baca dari ref, bukan closure state: dua perubahan yang terjadi dalam
        // satu batch render tidak boleh saling menimpa.
        const updatedAnswers = { ...answersRef.current, [questionId]: answerStr };
        answersRef.current = updatedAnswers;
        setAnswers(updatedAnswers);

        const att = attemptRef.current;
        if (!att) return;

        const q = questionsRef.current.find((question) => question.id === questionId);
        const payload = answerColumns(q, answersRef.current[questionId], doubtfulRef.current.has(questionId), revision);
        markFailed(questionId, true);
        const localWrite = await writeExamSnapshot(att.id, {
            answers: updatedAnswers,
            revisions: { ...revisionsRef.current },
            doubtfulAnswers: Array.from(doubtfulRef.current),
        });
        storageStateRef.current = !localWrite.saved ? 'unavailable' : localWrite.mode === 'localstorage' ? 'fallback' : 'healthy';
        if (!localWrite.saved) {
            setStorageWarning('Snapshot lokal gagal disimpan. Jangan lanjutkan dalam keadaan offline; hubungi proktor.');
        } else if (localWrite.mode === 'localstorage') {
            setStorageWarning('IndexedDB tidak tersedia. Jangan tutup atau memuat ulang browser saat offline.');
        }

        // Saat browser sudah mendeteksi offline, jangan menunggu timeout HTTP.
        // Snapshot lokal adalah sumber antrean dan akan disinkronkan saat online.
        if (!navigator.onLine || offlineRecoveryRef.current) {
            markFailed(questionId, true);
            return;
        }

        // Hasil autosave WAJIB diperiksa. Kegagalan (sesi kedaluwarsa, attempt
        // sudah bukan in_progress, 500 sekejap) ditandai supaya retry berkala
        // dan flush penutupan bisa menyusulkannya.
        inFlightRef.current.add(questionId);
        await saveQueueRef.current.enqueue(questionId, async () => {
            if (revisionsRef.current[questionId] !== revision || submitInFlightRef.current) return;
            try {
                const res = await saveAnswerAction(att.id, questionId, payload);
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, !res?.success);
            } catch {
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [markFailed, submissionOnly]);

    const toggleDoubtful = useCallback(async (questionId: string) => {
        if (submissionOnly || frozenSnapshotRef.current || submitInFlightRef.current || clockRef.current.remainingSeconds() <= 0) return;
        const revision = (revisionsRef.current[questionId] ?? 0) + 1;
        revisionsRef.current[questionId] = revision;
        const newDoubtful = new Set(doubtfulRef.current);
        if (newDoubtful.has(questionId)) {
            newDoubtful.delete(questionId);
            toast.info('Tanda ragu dihapus');
        } else {
            newDoubtful.add(questionId);
            toast.warning('Ditandai ragu', 'Soal ini akan ditandai saat review');
        }
        doubtfulRef.current = newDoubtful;
        setDoubtfulAnswers(newDoubtful);

        const att = attemptRef.current;
        if (!att) return;

        const q = questionsRef.current.find((question) => question.id === questionId);
        const payload = answerColumns(q, answersRef.current[questionId], doubtfulRef.current.has(questionId), revision);
        markFailed(questionId, true);
        const localWrite = await writeExamSnapshot(att.id, {
            answers: { ...answersRef.current },
            revisions: { ...revisionsRef.current },
            doubtfulAnswers: Array.from(newDoubtful),
        });
        storageStateRef.current = !localWrite.saved ? 'unavailable' : localWrite.mode === 'localstorage' ? 'fallback' : 'healthy';
        if (!localWrite.saved) {
            setStorageWarning('Snapshot lokal gagal disimpan. Jangan lanjutkan dalam keadaan offline; hubungi proktor.');
        } else if (localWrite.mode === 'localstorage') {
            setStorageWarning('IndexedDB tidak tersedia. Jangan tutup atau memuat ulang browser saat offline.');
        }

        if (!navigator.onLine || offlineRecoveryRef.current) {
            markFailed(questionId, true);
            return;
        }

        inFlightRef.current.add(questionId);
        await saveQueueRef.current.enqueue(questionId, async () => {
            if (revisionsRef.current[questionId] !== revision || submitInFlightRef.current) return;
            try {
                const res = await saveAnswerAction(att.id, questionId, payload);
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, !res?.success);
            } catch {
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [toast, markFailed, submissionOnly]);

    const handleRequestFullscreen = useCallback(() => {
        // Sebagian perangkat (iPhone/iPad Safari, sebagian WebView Android)
        // TIDAK punya requestFullscreen — memanggilnya melempar error sinkron
        // sehingga setIsFullScreen(true) di bawah tidak pernah jalan dan siswa
        // terjebak di layar "Aktifkan Layar Penuh". Fullscreen bersifat
        // best-effort; gerbang harus selalu terbuka setelah tombol ditekan.
        try {
            const el = document.documentElement as HTMLElement & {
                webkitRequestFullscreen?: () => Promise<void> | void;
                msRequestFullscreen?: () => Promise<void> | void;
            };
            const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
            if (request) {
                const p = request.call(el);
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch {
            // Perangkat tidak mendukung fullscreen — lanjutkan tanpa fullscreen.
        }
        setIsFullScreen(true);
    }, []);

    const safeMode = exam?.metadata?.is_safe_mode !== false;

    // ── Main Exam UI ───────────────────────────────────────────
    if (loading) {
        return <ExamPageSkeleton />;
    }

    if (accessDenied) {
        // Keadaan ini juga mencakup gangguan server/jaringan dan soal kosong,
        // jadi judulnya tidak boleh selalu menyimpulkan masalah izin.
        const isAlreadyFinished = accessError.toLowerCase().includes('sudah menyelesaikan');
        
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
                <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-100 max-w-md w-full text-center">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isAlreadyFinished ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                        {isAlreadyFinished ? (
                            <CheckCircle2 className="text-emerald-500" size={32} />
                        ) : (
                            <AlertTriangle className="text-rose-500" size={32} />
                        )}
                    </div>
                    <h1 className="text-xl font-bold text-slate-800 mb-2">
                        {isAlreadyFinished ? 'Ujian Telah Selesai' : 'Ujian Belum Dapat Dibuka'}
                    </h1>
                    <p className="text-slate-500 mb-6 text-sm">
                        {isAlreadyFinished 
                            ? 'Ujian ini telah selesai dikerjakan. Anda tidak dapat melihat soal lagi untuk alasan keamanan.' 
                            : accessError || 'Anda tidak memiliki akses ke ujian ini.'}
                    </p>
                    <button 
                        onClick={() => router.push('/dashboard/siswa')}
                        className="w-full bg-[#3083FF] hover:bg-[#2563EB] text-white font-bold py-3 rounded-lg transition-all shadow-sm"
                    >
                        Kembali ke Dashboard
                    </button>
                </div>
            </div>
        );
    }

    if (isCompleted) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
                <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-100 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="text-emerald-500" size={32} />
                    </div>
                    <h1 className="text-xl font-bold text-slate-800 mb-2">Ujian Berhasil Disimpan</h1>
                    <p className="text-slate-500 mb-6 text-sm">Jawaban Anda telah berhasil direkam. Anda tidak dapat melihat soal lagi untuk alasan keamanan.</p>
                    <button 
                        onClick={() => router.push('/dashboard/siswa')}
                        className="w-full bg-[#3083FF] hover:bg-[#2563EB] text-white font-bold py-3 rounded-lg transition-all shadow-sm"
                    >
                        Kembali ke Dashboard
                    </button>
                </div>
            </div>
        );
    }

    if (terminationPending) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
                <div className="bg-slate-900 p-8 rounded-2xl shadow-xl border border-rose-500/30 max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        {isOffline
                            ? <AlertTriangle className="text-amber-400" size={36} />
                            : <Loader2 className="text-rose-400 animate-spin" size={36} />}
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-3">Ujian Sedang Diamankan</h1>
                    <p className="text-slate-300 mb-6 leading-relaxed">
                        Batas pelanggaran telah tercapai. Sistem sedang menyimpan jawaban dan menunggu konfirmasi server.
                        <br/><strong className="text-rose-300">Jangan tutup atau memuat ulang halaman ini.</strong>
                    </p>
                    <div className="text-sm font-medium text-amber-300 bg-amber-500/10 py-3 px-4 rounded-lg border border-amber-500/20">
                        {isOffline ? 'Koneksi terputus. Proses dilanjutkan otomatis saat jaringan pulih.' : 'Menghubungi server dan memverifikasi status ujian...'}
                    </div>
                </div>
            </div>
        );
    }

    if (submissionOnly && !waitingForSyncAndSubmit) {
        return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-xl bg-white p-8 text-center border border-slate-200">
                <h1 className="text-xl font-bold mb-3">Jawaban Terkunci</h1>
                <p className="text-slate-600 mb-5">Anda hanya dapat mengirim jawaban yang sudah tersimpan. Jawaban dan lampiran tidak dapat diubah.</p>
                {recoverySummary && <p className="text-sm text-slate-500 mb-4">Lokal: {recoverySummary.localCount} jawaban · Server: {recoverySummary.serverCount} jawaban.</p>}
                {storageWarning && <p className="text-sm text-amber-700 mb-4">{storageWarning}</p>}
                <button disabled={submitting} onClick={() => void handleSubmitExam()} className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50">
                    {submitting ? 'Mengirim jawaban...' : 'Kirim Jawaban'}
                </button>
            </div>
        </div>;
    }

    if (waitingForSyncAndSubmit) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
                <div className="bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700 max-w-md w-full text-center animate-in fade-in zoom-in duration-500">
                    <div className="w-20 h-20 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                        <div className="absolute inset-0 border-4 border-slate-600 rounded-full"></div>
                        <div className="absolute inset-0 border-4 border-amber-500 rounded-full border-t-transparent animate-spin"></div>
                        <AlertTriangle className="text-amber-500" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-3">
                        {timeLeft <= 0 ? 'Waktu Habis' : 'Menunggu Koneksi'}
                    </h1>
                    <p className="text-slate-300 mb-6 text-base leading-relaxed">
                        Jawaban telah dikunci dan akan dikirim otomatis saat koneksi tersedia. Anda tidak perlu meminta pemulihan proktor. <br/><strong>Tetap buka halaman ini sampai pengiriman selesai.</strong>
                    </p>
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-amber-400 bg-amber-500/10 py-3 rounded-lg border border-amber-500/20">
                        <RefreshCw size={16} className="animate-spin" />
                        Mengirim otomatis saat terhubung...
                    </div>
                    {storageWarning && <p className="mt-4 text-sm text-amber-300">{storageWarning}</p>}
                </div>
            </div>
        );
    }

    return (
        <>
            {(isOffline || serverUnavailableAt) && !waitingForSyncAndSubmit && (
                <div role="alert" className="fixed top-0 left-0 right-0 z-[10005] bg-rose-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <AlertTriangle size={16} />
                    <span>
                        {usingOfflineRecovery ? 'Ujian dipulihkan setelah halaman dibuka ulang. ' : isOffline ? 'Jaringan perangkat terputus. ' : 'Koneksi ke server ujian belum berhasil. '}
                        {serverUnavailableAt && `Terdeteksi ${new Date(serverUnavailableAt).toLocaleTimeString('id-ID')}. `}
                        Waktu ujian tetap berjalan. Jangan tutup halaman.{' '}
                        {storageWarning ? `${storageWarning} Hubungi pengawas bila perlu bantuan.` : `${Object.keys(answers).length} jawaban tersedia di perangkat; pengiriman dicoba kembali saat koneksi pulih.`}
                    </span>
                </div>
            )}
            {!isOffline && !serverUnavailableAt && !waitingForSyncAndSubmit && failedSyncCount > 0 && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <RefreshCw size={16} className="animate-spin" />
                    <span>{failedSyncCount} jawaban belum tersimpan ke server. Mencoba mengirim ulang otomatis — jangan tutup halaman.</span>
                </div>
            )}
            {!isOffline && !serverUnavailableAt && !waitingForSyncAndSubmit && failedSyncCount === 0 && recoverySummary && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <ShieldCheck size={16} />
                    <span>
                        Pemulihan aktif sampai {new Date(recoverySummary.recoveryUntil).toLocaleString('id-ID')}.
                        {' '}Lokal: {recoverySummary.localCount} jawaban · Server: {recoverySummary.serverCount} jawaban.
                    </span>
                </div>
            )}
            {!isOffline && !serverUnavailableAt && !waitingForSyncAndSubmit && failedSyncCount === 0 && !recoverySummary && storageWarning && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-amber-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <AlertTriangle size={16} />
                    <span>{storageWarning}</span>
                </div>
            )}
            <ExamViewer
            mode="exam"
            questions={questions}
            answers={answers}
            doubtfulAnswers={doubtfulAnswers}
            onAnswerChange={(qId, val) => handleAnswerSelect(qId, val as string | string[])}
            onToggleDoubtful={toggleDoubtful}
            studentName={formatStudentName(profile?.full_name || user?.fullName || user?.email, 'Siswa')}
            studentNisn={profile?.identity_number || ''}
            examTitle={exam?.title || ''}
            currentQIndex={currentQIndex}
            onNavigate={setCurrentQIndex}
            timeLeft={timeLeft}
            isSafeMode={safeMode}
            violationCount={violationCount}
            maxViolations={maxViolations}
            showViolationModal={showViolationModal}
            violationType={violationType}
            onCloseViolationModal={() => setShowViolationModal(false)}
            onRequestFullscreen={handleRequestFullscreen}
            isFullScreen={isFullScreen}
            onSubmitExam={(assignmentSubmission?: { documentUrl?: string, videoUrl?: string }) => handleSubmitExam(assignmentSubmission)}
            submitting={submitting}
            isAssignment={exam?.exam_type === 'assignment'}
            assignmentData={exam?.metadata}
            examId={examId}
            userId={user?.id}
            assignmentFileUrls={assignmentFileUrls}
            onAssignmentFilesChange={setAssignmentFileUrls}
            onAssignmentTextChange={setAssignmentTextNote}
            updatedQuestionIds={updatedQuestionIds}
            onClearUpdated={(qId) => {
                setUpdatedQuestionIds(prev => {
                    const next = new Set(prev);
                    next.delete(qId);
                    return next;
                });
            }}
        />
        </>
    );
}
