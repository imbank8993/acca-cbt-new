"use client";
import { getErrorMessage } from '@/lib/errors';
import { formatStudentName } from '@/lib/monitoring-health';
import { ExamPageSkeleton } from '@/app/components/ui/SkeletonPatterns';
import { useToast } from '@/app/components/ui/Toast';
import { apiSend } from '@/lib/api/client';
import { forceTerminateAttempt,heartbeatExamAttempt,logSecurityViolation } from '@/lib/api/proctoring';
import { SESSION_ENDED_MESSAGE,getExamForAttempt,getExamQuestionsAction,getExamSubmissionStatus,refreshExamSessionAction,saveAnswerAction,startExamAttemptAction,submitExamAction,syncAnswersBulkAction,type StudentExam,type StudentExamAttempt,type StudentExamQuestion,type StudentProfile } from '@/lib/api/students';
import { getDeviceId,setDeviceId } from '@/lib/device-id';
import {
createSecurityEventId,
freezeExamSnapshot,
ExamSnapshotConflictError,
type ExamAnswerSnapshot,
type QueuedSecurityEvent,
enqueueSecurityEvent,
forgetExamOfflineOwner,
inspectExamStorage,
readExamOfflineOwner,
rememberExamOfflineOwner,
removeExamAttemptCaches,
readExamRecoverySession,
readExamSnapshot,
readSecurityEvents,
removeExamRecoverySession,
removeExamSnapshot,
archiveExamSnapshot,
readExamSnapshotGeneration,
writeExamSnapshotGeneration,
removeExamSubmissionRegistration,
removeSecurityEvent,
resolveDurableDeviceId,
updateExamRecoveryPosition,
updateExamRecoveryQuestions,
validateExamRecoverySession,
writeExamRecoverySession,
writeExamSnapshot,
} from '@/lib/exam-durable-storage';
import { cacheExamOfflineShell,isExamPwaEnabled,removeExamOfflineShell } from '@/lib/exam-pwa';
import { examAutoRetryDelay } from '@/lib/exam-retry';
import { mergeExamQuestionUpdates } from '@/lib/exam-question-updates';
import { sampleExamNetwork, examNetworkLabel } from '@/lib/exam-network';
import { ExamClock } from '@/lib/exam-clock';
import { hasExamFullscreen, supportsExamFullscreen, subscribeExamFullscreen, type FullscreenElement } from '@/lib/exam-fullscreen';
import { acquireExamEditorLock } from '@/lib/exam-editor-lock';
import { keepExamScreenAwake } from '@/lib/exam-wake-lock';
import { PerKeyQueue } from '@/lib/per-key-queue';
import { getSessionUser } from '@/lib/session';
import { clearCbtSession } from '@/lib/session-reset';
import { AlertTriangle,CheckCircle2,Loader2,RefreshCw } from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { AuthUser } from '@acca-cbt/shared';
import { ExamViewer } from './ExamViewer';
import { ExamStartPreparation } from './ExamStartPreparation';
import { useExamScreenshots } from '@/hooks/useExamScreenshots';
import { SCREEN_SHARE_GRACE_MS,SCREEN_SHARE_LOST_EVENT,SCREEN_SHARE_RACE_MS,screenshotBase64 } from '@/lib/exam-screenshots';
import { retryExamEvidence } from '@/lib/exam-evidence-outbox';

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
    const screenshots = useExamScreenshots(examId, isCompleted);
    const { sharingRef: screenSharingRef, requesting: screenRequestingRef, capture: captureScreenshot, upload: uploadScreenshot } = screenshots;
    const wasScreenSharing = useRef(false);
    /** Kapan berbagi layar terakhir terputus (0 = sedang aktif). */
    const shareLostAtRef = useRef(0);
    /** Sisa detik toleransi sebelum terputusnya berbagi layar dihitung pelanggaran. */
    const [shareGraceLeft, setShareGraceLeft] = useState<number | null>(null);
    const [questions, setQuestions] = useState<StudentExamQuestion[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [doubtfulAnswers, setDoubtfulAnswers] = useState<Set<string>>(new Set());
    const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const confirmedStartExamIdRef = useRef<string | null>(null);
    const fetchExamDataRef = useRef<(() => Promise<void>) | null>(null);
    const [awaitingStart, setAwaitingStart] = useState(false);

    // Cermin ref dari state jawaban. Interval retry, handler `pagehide`, dan
    // flush sebelum force-logout berjalan di luar siklus render, jadi mereka
    // tidak boleh membaca closure state yang bisa basi.
    const revisionsRef = useRef<Record<string, number>>({});
    const clockRef = useRef(new ExamClock());
    const answersRef = useRef<Record<string, string>>({});
    const doubtfulRef = useRef<Set<string>>(new Set());
    const questionsRef = useRef<StudentExamQuestion[]>([]);
    const attemptRef = useRef<StudentExamAttempt | null>(null);
    const ownsEditorLockRef = useRef(false);
    // Soal yang autosave-nya GAGAL terkirim, dan yang requestnya masih terbang.
    // Dulu kegagalan ditelan diam-diam (`.catch(() => {})`): centang terakhir
    // pada PGK bisa tidak pernah sampai ke server, dan jalur penutupan yang
    // menilai dari DB (pelanggaran, force-submit proktor, kedaluwarsa) memakai
    // data tertinggal itu — "centang 3, terekam 2".
    const failedSyncRef = useRef<Set<string>>(new Set());
    const inFlightRef = useRef<Set<string>>(new Set());
    const saveQueueRef = useRef(new PerKeyQueue());
    const [failedSyncCount, setFailedSyncCount] = useState(0);
    // Penolakan server yang tidak akan berhasil bila sekadar dicoba ulang
    // (perangkat dipindahkan, sesi berakhir, versi bentrok). Dulu tampil sebagai
    // "menunggu sinkronisasi … dicoba otomatis" padahal tidak akan pernah masuk.
    const [syncRejection, setSyncRejection] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [timeLeft, setTimeLeft] = useState(0);
    const [attempt, setAttempt] = useState<StudentExamAttempt | null>(null);
    const [assignmentFileUrls, setAssignmentFileUrls] = useState<string[]>([]);
    const [assignmentTextNote, setAssignmentTextNote] = useState('');
    const [assignmentDocumentUrl, setAssignmentDocumentUrl] = useState('');
    const assignmentRef = useRef<NonNullable<ExamAnswerSnapshot['assignmentData']>>({});
    const assignmentRevisionRef = useRef(0);

    // UI State
    const [accessDenied, setAccessDenied] = useState(false);
    const [accessError, setAccessError] = useState('');

    // Offline Tolerance
    const networkSampleRef = useRef({ weak: false, streak: 0 });
    const [isNetworkWeak, setIsNetworkWeak] = useState(false);
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
    useEffect(() => {
        const syncFullscreen = () => setIsFullScreen(hasExamFullscreen() || !supportsExamFullscreen());
        syncFullscreen();
        return subscribeExamFullscreen(syncFullscreen);
    }, [examId]);
    const [violationCount, setViolationCount] = useState(0);
    const [showViolationModal, setShowViolationModal] = useState(false);
    const [violationType, setViolationType] = useState('');
    useEffect(() => {
        if (!showViolationModal) return;
        const timer = setTimeout(() => setShowViolationModal(false), 8000);
        return () => clearTimeout(timer);
    }, [showViolationModal, violationCount, violationType]);
    const [terminationPending, setTerminationPending] = useState<string | null>(null);
    const savedViolationsRef = useRef<Set<string>>(new Set());
    const violationCountRef = useRef(0);
    const terminationInFlightRef = useRef(false);
    const terminationReasonRef = useRef<string | null>(null);
    // Prevents concurrent / repeated submits (manual double-click, auto-submit retry loop).
    const submitInFlightRef = useRef(false);
    const submissionSucceededRef = useRef(false);
    // Descriptors exist before any async capture/storage work, so the final
    // answer request can register them without waiting for image encoding.
    const pendingSecurityEventsRef = useRef(new Map<string, QueuedSecurityEvent>());
    const frozenSnapshotRef = useRef<ExamAnswerSnapshot | null>(null);
    const [submissionOnly, setSubmissionOnly] = useState(false);
    const [submissionIssue, setSubmissionIssue] = useState<string | null>(null);
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
    // Jam ujian dihitung dari jam perangkat (pemulihan offline), bukan dari sisa
    // waktu server. Kunci "waktu habis" dari jam ini belum tentu benar.
    const clockFromDeviceRef = useRef(false);
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
        let disposed = false;
        let checking = false;

        const checkUpdates = async () => {
            if (disposed || checking || !navigator.onLine || questionsRef.current.length === 0) return;
            checking = true;
            const attemptId = attemptRef.current?.id;
            try {
                const currentRevs: Record<string, number> = {};
                questionsRef.current.forEach(q => {
                    currentRevs[q.id] = (q as { revision?: number }).revision || 1;
                });

                const res = await apiSend<{
                    hasUpdates: boolean;
                    updatedQuestionIds: string[];
                    questions: StudentExamQuestion[];
                }>(
                    `/api/students/exams/${encodeURIComponent(examId)}/questions/check-updates`,
                    { revisions: currentRevs, deviceId: getDeviceId() },
                    'POST',
                );

                if (!disposed && attemptId && attemptRef.current?.id === attemptId &&
                    res.success && res.hasUpdates && res.updatedQuestionIds?.length > 0) {
                    const next = mergeExamQuestionUpdates(questionsRef.current, res.questions || []);
                    questionsRef.current = next;
                    setQuestions(next);
                    try { await updateExamRecoveryQuestions(examId, attemptId, next); }
                    catch { /* Online revisions still render when offline storage is unavailable. */ }
                    if (disposed || attemptRef.current?.id !== attemptId) return;

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

                }
            } catch {
                // Ignore silent background update check errors
            } finally {
                checking = false;
            }
        };

        const timer = setInterval(checkUpdates, 15000);
        const reconnect = () => { void checkUpdates(); };
        window.addEventListener('online', reconnect);
        void checkUpdates();
        return () => { disposed = true; clearInterval(timer); window.removeEventListener('online', reconnect); };
    }, [examId, isCompleted, accessDenied, loading]);

    /** Tandai/lepas tanda "gagal tersimpan" untuk satu soal. */
    const noteSyncResult = useCallback((res: { success: boolean; error?: string; retryable?: boolean; unauthorized?: boolean } | null | undefined) => {
        if (!res) return;
        if (res.success) setSyncRejection(null);
        else if (res.unauthorized) setSyncRejection(SESSION_ENDED_MESSAGE);
        else if (res.retryable === false) setSyncRejection(res.error || 'Server menolak jawaban.');
    }, []);
    // Disalin ke ref supaya heartbeat dapat melaporkannya ke pengawas.
    const syncRejectionRef = useRef<string | null>(null);
    useEffect(() => { syncRejectionRef.current = syncRejection; }, [syncRejection]);

    // Sesi login berlaku 12 jam sejak login dan dulu tidak diperpanjang: siswa
    // yang login jauh sebelum ujian kehilangan sesinya di tengah pengerjaan.
    // Selama pengerjaan aktif, sesi diperpanjang saat dibuka lalu tiap 30 menit.
    useEffect(() => {
        if (!attempt?.id || attempt.status !== 'in_progress' || isCompleted) return;
        let stopped = false;
        const refresh = () => {
            if (stopped || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
            void refreshExamSessionAction().then(res => { if (!stopped && res && !res.success && res.unauthorized) setSyncRejection(SESSION_ENDED_MESSAGE); })
                .catch(() => undefined);
        };
        refresh();
        const timer = setInterval(refresh, 30 * 60_000);
        return () => { stopped = true; clearInterval(timer); };
    }, [attempt?.id, attempt?.status, isCompleted]);

    const markFailed = useCallback((questionId: string, failed: boolean) => {
        const set = failedSyncRef.current;
        if (failed) set.add(questionId); else set.delete(questionId);
        setFailedSyncCount(set.size);
    }, []);

    const restoreAssignment = useCallback((attemptId: string, snapshot: ExamAnswerSnapshot | null) => {
        let data = snapshot?.assignmentData;
        if (!data) {
            try {
                const legacy = JSON.parse(localStorage.getItem(`exam_assignment_${attemptId}`) || '{}');
                data = { fileUrls: Array.isArray(legacy.fileUrls) ? legacy.fileUrls : [],
                    textSubmission: typeof legacy.textNote === 'string' ? legacy.textNote : '',
                    documentUrl: typeof legacy.documentUrl === 'string' ? legacy.documentUrl : undefined };
            } catch { data = {}; }
        }
        // Ordinary exams must not acquire a phantom assignment from empty legacy defaults.
        if (!data.documentUrl && !data.videoUrl && !data.fileUrls?.length && !data.textSubmission) data = {};
        assignmentRef.current = data;
        assignmentRevisionRef.current = snapshot?.assignmentRevision ?? 0;
        setAssignmentFileUrls(data.fileUrls || []);
        setAssignmentTextNote(data.textSubmission || '');
        setAssignmentDocumentUrl(data.documentUrl || '');
        pendingAssignmentRef.current = { documentUrl: data.documentUrl, videoUrl: data.videoUrl };
    }, []);

    const updateAssignment = useCallback((patch: Partial<NonNullable<ExamAnswerSnapshot['assignmentData']>>) => {
        if (!ownsEditorLockRef.current) return;
        if (exam?.metadata?.screenshot_enabled === true && !screenSharingRef.current) return;
        const att = attemptRef.current;
        if (!att || frozenSnapshotRef.current || submitInFlightRef.current || clockRef.current.remainingSeconds() <= 0) return;
        const data = { ...assignmentRef.current, ...patch };
        assignmentRef.current = data;
        assignmentRevisionRef.current += 1;
        setAssignmentFileUrls(data.fileUrls || []);
        setAssignmentTextNote(data.textSubmission || '');
        setAssignmentDocumentUrl(data.documentUrl || '');
        pendingAssignmentRef.current = { documentUrl: data.documentUrl, videoUrl: data.videoUrl };
        void writeExamSnapshot(att.id, {
            answers: { ...answersRef.current }, revisions: { ...revisionsRef.current },
            doubtfulAnswers: Array.from(doubtfulRef.current), assignmentData: data,
            assignmentRevision: assignmentRevisionRef.current,
        }).then(result => {
            storageStateRef.current = !result.saved ? 'unavailable' : result.mode === 'localstorage' ? 'fallback' : 'healthy';
            if (!result.saved) setStorageWarning('Lampiran atau catatan tugas belum tersimpan di perangkat. Jangan tutup halaman; hubungi proktor.');
            else if (result.mode === 'localstorage') setStorageWarning('Cadangan tugas tersimpan di browser. Jangan hapus data browser sebelum pengumpulan dikonfirmasi.');
        }).catch(() => setStorageWarning('Cadangan tugas gagal disimpan. Jangan tutup halaman; hubungi proktor.'));
    }, [exam?.metadata?.screenshot_enabled, screenSharingRef]);

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
            const res = await syncAnswersBulkAction(att.id, rows, att.started_at);
            noteSyncResult(res);
            if (res?.success) {
                ids.forEach(id => {
                    if (revisionsRef.current[id] === sentRevisions[id]) failedSyncRef.current.delete(id);
                });
                setFailedSyncCount(failedSyncRef.current.size);
            }
        } catch {
            // Biarkan tetap tertandai — percobaan berikutnya menyusul.
        }
    }, [noteSyncResult]);

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
                [JSON.stringify({ attemptId: att.id, answers: rows, deviceId: getDeviceId(), sessionStartedAt: att.started_at })],
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
        let cancelled = false;
        let releaseEditor: (() => void) | null = null;
        async function fetchExamData() {
            if (cancelled) return;
            setLoading(true);
            setAccessDenied(false);
            setRecoverySummary(null);
            setStorageWarning(null);
            try {
                // Penyimpanan dan ID perangkat harus siap sebelum jaringan
                // diperiksa, karena keduanya juga menjadi pagar pemulihan
                // ketika seluruh endpoint sedang tidak dapat dijangkau.
                const storageHealth = await inspectExamStorage();
                if (cancelled) return;
                storageStateRef.current = !storageHealth.available ? 'unavailable' : storageHealth.mode === 'localstorage' ? 'fallback' : 'healthy';
                if (!storageHealth.available) {
                    setAccessDenied(true);
                    setAccessError(storageHealth.warning || 'Penyimpanan jawaban tidak tersedia.');
                    setLoading(false);
                    return;
                }
                setStorageWarning(storageHealth.warning || null);
                const durableDeviceId = await resolveDurableDeviceId(getDeviceId());
                if (cancelled) return;
                setDeviceId(durableDeviceId);

                const restoreOfflineSession = async (knownUserId?: string | null): Promise<boolean> => {
                    let cached;
                    try {
                        cached = await readExamRecoverySession(examId);
                        if (cancelled) return false;
                    } catch {
                        return false;
                    }
                    if (!cached) return false;
                    // Tanpa server, pemilik paket hanya dapat dicocokkan dengan akun
                    // terakhir yang diverifikasi di perangkat ini (dihapus saat logout).
                    const ownerId = knownUserId ?? readExamOfflineOwner();
                    if (!ownerId) {
                        setAccessDenied(true);
                        setAccessError(
                            'Sesi ujian offline di perangkat ini tidak dapat dibuka karena akun belum terverifikasi. ' +
                            'Sambungkan internet lalu masuk kembali dengan akun peserta ujian ini.',
                        );
                        setLoading(false);
                        return true;
                    }
                    const checked = validateExamRecoverySession(cached, {
                        examId,
                        deviceId: durableDeviceId,
                        userId: ownerId,
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
                    if (cancelled) return false;
                    const restoredAnswers = local?.answers || {};
                    const deviceDeadlinePassed = session.deadlineAt <= Date.now();
                    const locked = deviceDeadlinePassed || Boolean(local?.frozenSubmission) || session.attempt.metadata?.recovery_submit_only === true;
                    if (local?.frozenSubmission) frozenSnapshotRef.current = local;
                    setSubmissionOnly(locked);
                    if (locked) setWaitingForSyncAndSubmit(true);
                    answersRef.current = restoredAnswers;
                    revisionsRef.current = { ...(local?.revisions || {}) };
                    restoreAssignment(session.attemptId, local);
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
                    clockFromDeviceRef.current = true;
                    setTimeLeft(remaining);
                    setCurrentQIndex(Math.min(
                        Math.max(0, session.lastQuestionIndex),
                        Math.max(0, restoredQuestions.length - 1),
                    ));
                    setStorageWarning(deviceDeadlinePassed && !local?.frozenSubmission
                        ? 'Menurut jam perangkat waktu ujian sudah habis. Sisa waktu sebenarnya diperiksa ke server saat tersambung; bila masih ada, ujian dibuka kembali.'
                        : 'Ujian dipulihkan dari perangkat ini. Akses server akan diverifikasi sebelum jawaban dikirim.',
                    );
                    setLoading(false);
                    return true;
                };

                let authUser: AuthUser | null;
                try {
                    authUser = await getSessionUser();
                } catch (error) {
                    // A temporary /api/auth/me failure is not a rejected session.
                    // The validated local recovery package still lets the student
                    // continue until its original deadline while the API recovers.
                    if (await restoreOfflineSession(null)) return;
                    throw error;
                }
                if (cancelled) return;
                if (authUser) {
                    setUser(authUser);
                    rememberExamOfflineOwner(authUser.id);
                } else if (navigator.onLine) {
                    // Server menolak sesi: paket offline tidak boleh dibuka lagi tanpa login ulang.
                    forgetExamOfflineOwner();
                }
                if (!authUser && !navigator.onLine && await restoreOfflineSession(null)) return;

                // Keterangan ujian dan identitas peserta datang bersama dalam
                // satu permintaan. Kepala layar menampilkan "Nama • NISN", jadi
                // profilnya memang dibutuhkan di sini — dan mengambil keduanya
                // sekaligus menghemat satu putaran jaringan di awal ujian.
                const detail = await getExamForAttempt(examId);
                if (cancelled) return;

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
                if (examData.metadata?.screenshot_enabled === true && !screenSharingRef.current) {
                    setAwaitingStart(true);
                    setLoading(false);
                    return;
                }

                if (!detail.hasStartedAttempt && confirmedStartExamIdRef.current !== examId) {
                    setAwaitingStart(true);
                    setLoading(false);
                    return;
                }
                setAwaitingStart(false);

                // Fullscreen may have ended while identity/details were loading.
                // A fresh attempt still needs fullscreen and a new confirmation.
                if (!detail.hasStartedAttempt && supportsExamFullscreen() && !hasExamFullscreen()) {
                    confirmedStartExamIdRef.current = null;
                    setAwaitingStart(true);
                    setLoading(false);
                    return;
                }

                // Start or resume attempt (bound to this device — see device lock)
                const startRequestedAt = performance.now();
                const result = await startExamAttemptAction(examId, durableDeviceId, screenSharingRef.current);
                if (cancelled) return;
                clockRef.current.anchor(Math.max(0, (result.success ? result.remainingSeconds : 0) - (performance.now() - startRequestedAt) / 1000));
                clockFromDeviceRef.current = false;
                if (!result.success) {
                    if (result.retryable && await restoreOfflineSession(authUser.id)) return;
                    const pendingSession = await readExamRecoverySession(examId).catch(() => null);
                    if (cancelled) return;
                    if (result.expiredAttemptId && pendingSession?.attemptId === result.expiredAttemptId) {
                        const pendingSnapshot = await readExamSnapshot(result.expiredAttemptId).catch(() => null);
                        if (cancelled) return;
                        if ((pendingSession.deadlineAt <= Date.now() || pendingSnapshot?.frozenSubmission) &&
                            await restoreOfflineSession(authUser.id)) return;
                        const status = await getExamSubmissionStatus(result.expiredAttemptId);
                        if (cancelled) return;
                        if (status.success && status.examId === examId && status.status === 'submitted') {
                            setIsCompleted(true);
                            setLoading(false);
                            return;
                        }
                    }
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

                // Get questions from the bank — WAJIB lewat server action.
                // Query langsung dari browser (anon key) membuat RLS bisa
                // memblokir embed opsi secara diam-diam → "soal tanpa opsi".
                let loadedQuestions: StudentExamQuestion[] = [];
                // Endpoint backend menyatukan `question_bank_id` dan seluruh
                // `cbt_exam_question_sources`; browser tidak boleh menebak
                // sumber hanya dari kolom bank langsung.
                const qRes = result.attempt.metadata?.recovery_submit_only === true
                    ? { success: true as const, questions: [] as StudentExamQuestion[] }
                    : await getExamQuestionsAction(examId);
                if (cancelled) return;
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
                } else if (examData.exam_type !== 'assignment' && result.attempt.metadata?.recovery_submit_only !== true) {
                    setAccessDenied(true);
                    setAccessError('Bank soal belum tersedia untuk ujian ini.');
                    setLoading(false);
                    return;
                }

                const makeupActivatedAt = result.attempt.metadata?.makeup_activated_at;
                if (typeof makeupActivatedAt === 'string') {
                    // Salinan lokal hanya dibuang bila TERBUKTI milik generasi lama
                    // (started_at berbeda). Dulu paket cache yang hilang — logout,
                    // sesi berakhir, gagal simpan — dianggap "lama" dan jawaban yang
                    // belum terkirim ikut terhapus. Bila asal-usulnya tidak diketahui,
                    // salinan diarsipkan (tidak dihapus) dan tidak dicampur.
                    const previousSession = await readExamRecoverySession(examId).catch(() => null);
                    const localCopy = await readExamSnapshot(result.attempt.id).catch(() => null);
                    const localStart = localCopy?.frozenSubmission?.startedAt
                        ?? readExamSnapshotGeneration(result.attempt.id)
                        ?? previousSession?.attempt.started_at ?? null;
                    const staleCopy = Boolean(localCopy) && (localStart
                        ? Date.parse(localStart) !== Date.parse(result.attempt.started_at || '')
                        : true);
                    if (staleCopy) {
                        await archiveExamSnapshot(result.attempt.id);
                        await removeExamSnapshot(result.attempt.id);
                        if (previousSession?.attempt.started_at && previousSession.attempt.personal_end_time) {
                            await removeExamSubmissionRegistration(result.attempt.id,
                                previousSession.attempt.started_at, previousSession.attempt.personal_end_time);
                        }
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
                // Tandai generasi pemilik salinan lokal untuk pemeriksaan berikutnya.
                writeExamSnapshotGeneration(result.attempt.id, result.attempt.started_at);
                if (cancelled) return;
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

                let localSnapshot: ExamAnswerSnapshot | null = null;
                try {
                    const parsed = await readExamSnapshot(result.attempt.id);
                    localSnapshot = parsed;
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

                restoreAssignment(result.attempt.id, localSnapshot);

                // A submit-only session deliberately has no question content.
                // Do not discard its local answers via the loadedQuestions filter,
                // or replace an immutable submission with the server's older draft.
                if (localSnapshot && (recoverySubmitOnly || localSnapshot.frozenSubmission)) {
                    Object.keys(savedA).forEach(id => delete savedA[id]);
                    Object.assign(savedA, localSnapshot.answers);
                    revisionsRef.current = { ...localSnapshot.revisions };
                    savedD.clear();
                    localSnapshot.doubtfulAnswers.forEach(id => savedD.add(id));
                    localAnswerIds = Object.keys(localSnapshot.answers);
                }
                // Pemulihan pengumpulan dibuka untuk mengirim salinan lokal. Dulu
                // layar "Jawaban Terkunci" menunggu siswa menekan tombol; bila
                // tidak ditekan sebelum jendela pemulihan habis, ujian ditutup lagi
                // hanya dengan jawaban server. Kirim otomatis selama tersambung.
                if (recoverySubmitOnly && localSnapshot && Object.keys(localSnapshot.answers || {}).length > 0) {
                    setWaitingForSyncAndSubmit(true);
                }

                answersRef.current = savedA;
                doubtfulRef.current = savedD;
                setAnswers(savedA);
                setDoubtfulAnswers(savedD);
                if (!recoverySubmitOnly && !localSnapshot?.frozenSubmission) {
                    await writeExamSnapshot(result.attempt.id, {
                        answers: savedA, doubtfulAnswers: Array.from(savedD), revisions: { ...revisionsRef.current },
                        assignmentData: assignmentRef.current, assignmentRevision: assignmentRevisionRef.current,
                    });
                }

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
                        const sync = await syncAnswersBulkAction(result.attempt.id, rows, result.attempt.started_at);
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
                if (cancelled) return;
                console.error("[ExamPage] Error fetching exam:", err);
                setAccessDenied(true);
                setAccessError(getErrorMessage(err) || 'Terjadi kesalahan saat memuat ujian.');
            }
            if (!cancelled) setLoading(false);
        }
        fetchExamDataRef.current = fetchExamData;
        void acquireExamEditorLock(examId).then(release => {
            if (cancelled) { release?.(); return; }
            if (!release) {
                setAccessDenied(true);
                setAccessError('Ujian ini sedang dibuka di tab lain. Tutup tab tersebut, lalu muat ulang halaman ini.');
                setLoading(false);
                return;
            }
            releaseEditor = release;
            ownsEditorLockRef.current = true;
            void fetchExamData();
        }).catch(error => {
            if (cancelled) return;
            setAccessDenied(true);
            setAccessError(getErrorMessage(error));
            setLoading(false);
        });
        return () => { cancelled = true; fetchExamDataRef.current = null; ownsEditorLockRef.current = false; releaseEditor?.(); };
    }, [examId, restoreAssignment, screenSharingRef]);

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
        if (!ownsEditorLockRef.current || !user || submitInFlightRef.current || terminationReasonRef.current) return;
        if (!opts?.isAuto && !submissionOnly && !frozenSnapshotRef.current &&
            exam?.metadata?.screenshot_enabled === true && !screenSharingRef.current) return;

        const isAssignment = exam?.exam_type === 'assignment';
        if (assignmentSubmission) pendingAssignmentRef.current = assignmentSubmission;

        const activeAttempt = attemptRef.current;
        if (!activeAttempt) return;
        // Pengumpulan otomatis karena "waktu habis" menurut jam perangkat wajib
        // dikonfirmasi server dulu. Dulu jam perangkat yang maju membuat ujian
        // yang masih punya sisa waktu langsung dikunci dan dikumpulkan saat online.
        if (opts?.isAuto && clockFromDeviceRef.current && !frozenSnapshotRef.current &&
            activeAttempt.metadata?.recovery_submit_only !== true) {
            setSubmissionOnly(true);
            setWaitingForSyncAndSubmit(true);
            if (!navigator.onLine) return;
            submitInFlightRef.current = true;
            const status = await getExamSubmissionStatus(activeAttempt.id).catch(() => null);
            submitInFlightRef.current = false;
            if (!status?.success) return;
            if ((status.startedAt && Date.parse(status.startedAt) !== Date.parse(activeAttempt.started_at || '')) ||
                (status.status === 'in_progress' && status.remainingSeconds > 0 && !status.submissionOnly)) {
                window.location.reload();
                return;
            }
            clockFromDeviceRef.current = false;
        }
        if (!opts?.isAuto) autoRetryCountRef.current = 0;
        setSubmissionIssue(null);
        if (!frozenSnapshotRef.current) {
            frozenSnapshotRef.current = {
                answers: { ...answersRef.current }, revisions: { ...revisionsRef.current },
                doubtfulAnswers: Array.from(doubtfulRef.current),
                ...(activeAttempt.started_at && activeAttempt.personal_end_time ? {
                    frozenSubmission: { startedAt: activeAttempt.started_at, personalEndTime: activeAttempt.personal_end_time },
                } : {}),
                assignmentData: isAssignment ? {
                    ...assignmentRef.current, ...pendingAssignmentRef.current,
                } : undefined,
                assignmentRevision: assignmentRevisionRef.current,
            };
        }
        setSubmissionOnly(true);
        submitInFlightRef.current = true;
        try {
            frozenSnapshotRef.current = await freezeExamSnapshot(activeAttempt.id, frozenSnapshotRef.current);
        } catch (error) {
            if (error instanceof ExamSnapshotConflictError) {
                submitInFlightRef.current = false;
                setWaitingForSyncAndSubmit(false);
                setAccessDenied(true);
                setAccessError(error.message);
                return;
            }
            storageStateRef.current = 'unavailable';
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
        setWaitingForSyncAndSubmit(true);

        try {
            const durableEvents = await readSecurityEvents(activeAttempt.id).catch(() => []);
            const eventManifest = new Map(durableEvents.map(event => [event.id, event]));
            for (const event of pendingSecurityEventsRef.current.values()) {
                if (event.attemptId === activeAttempt.id) eventManifest.set(event.id, event);
            }
            const securityEvents = Array.from(eventManifest.values())
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-100)
                .map(({ id, eventType, metadata, createdAt }) => ({ id, eventType, metadata, createdAt }));
            // Retry the same frozen payload; the server validates its attempt and device.
            const result = await submitExamAction(
                examId,
                snapshot.answers,
                snapshot.assignmentData,
                activeAttempt.id,
                snapshot.revisions,
                snapshot.frozenSubmission,
                securityEvents,
            );
            const acceptedEvents = new Set(result.acceptedSecurityEventIds || []);
            for (const event of durableEvents) {
                if (acceptedEvents.has(event.id) && !event.screenshotBase64) {
                    await removeSecurityEvent(activeAttempt.id, event.id, event).catch(() => undefined);
                }
            }
            if (result.success) {
                autoRetryCountRef.current = 0;
                submissionSucceededRef.current = true;
                setIsCompleted(true);
                void retryExamEvidence(activeAttempt.id).catch(() => undefined);
                if (result.savedAnswersOnly) {
                    toast.warning('Waktu ujian berakhir', 'Hanya jawaban yang sudah sampai di server dinilai. Salinan lokal dipertahankan untuk pemulihan dengan persetujuan proktor.');
                } else if (result.alreadySubmitted) {
                    toast.success('Jawaban sudah tersimpan', 'Seluruh jawaban di perangkat ini sudah ada di server. Tidak ada yang perlu dikirim ulang.');
                } else if (result.gradingPending) {
                    toast.success('Jawaban berhasil dikumpulkan', 'Penilaian sedang menunggu layanan tersedia. Jawaban sudah aman di server.');
                } else {
                    toast.success(isAssignment ? 'Tugas berhasil dikumpulkan!' : 'Ujian berhasil disubmit!');
                }
                if (attempt?.id && !result.savedAnswersOnly) {
                    await removeExamSnapshot(attempt.id).catch(() => undefined);
                    await removeExamSubmissionRegistration(attempt.id, activeAttempt.started_at, activeAttempt.personal_end_time).catch(() => undefined);
                    // Server has confirmed the commit; cache cleanup must not change its outcome.
                    removeExamAttemptCaches(attempt.id);
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
                    const issue = result.error || 'Pengumpulan perlu diperiksa.';
                    setSubmissionIssue(issue + (storageStateRef.current === 'unavailable'
                        ? ' Cadangan lokal belum berhasil disimpan. Jangan tutup halaman; hubungi proktor.'
                        : /salinan|cadangan/i.test(issue) ? '' : ' Salinan jawaban tetap tersimpan di perangkat ini.'));
                    return;
                }
                setSubmitting(false);
                setWaitingForSyncAndSubmit(true);
                submitInFlightRef.current = false;
                scheduleAutoRetry();
            }
        } catch {
            setSubmitting(false);
            setWaitingForSyncAndSubmit(true);
            submitInFlightRef.current = false;
            scheduleAutoRetry();
        }
    }, [user, examId, exam, router, toast, attempt, scheduleAutoRetry, screenSharingRef, submissionOnly]);

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
                    const res = await syncAnswersBulkAction(att.id, answersArray, att.started_at);
                    if (res.success) {
                        // Seluruh snapshot durable baru saja dikirim ulang.
                        answersArray.forEach(row => {
                            if ((revisionsRef.current[row.questionId] ?? 0) === row.revision) failedSyncRef.current.delete(row.questionId);
                        });
                        setFailedSyncCount(failedSyncRef.current.size);
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
    }, []);

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
        const result = await startExamAttemptAction(examId, getDeviceId(), screenSharingRef.current);
        if (!result.success) {
            if (result.retryable) {
                setIsOffline(true);
                return false;
            }
            // Ujian berbagi layar setelah muat ulang: server meminta layar dibagikan
            // lagi. Ini bukan sesi yang ditutup; paket offline jangan dihapus.
            if (/Bagikan seluruh layar/i.test(result.error || '')) {
                setIsOffline(false);
                setStorageWarning('Bagikan kembali seluruh layar agar jawaban dapat dikirim ke server. Jawaban tetap tersimpan di perangkat ini.');
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
        // Attempt yang sama tetapi generasi baru (susulan / mulai ulang saat offline):
        // jawaban lama tidak boleh dikirim ke pengerjaan baru. Muat ulang lewat jalur
        // normal, yang memisahkan (mengarsipkan) salinan generasi lama.
        if (result.attempt?.started_at && localAttempt.started_at &&
            Date.parse(result.attempt.started_at) !== Date.parse(localAttempt.started_at)) {
            window.location.reload();
            return false;
        }

        const remaining = Math.max(0, (result.remainingSeconds || 0) - (performance.now() - startRequestedAt) / 1000);
        clockRef.current.anchor(remaining);
        clockFromDeviceRef.current = false;
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
    }, [examId, submissionOnly, screenSharingRef]);

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

    const securityFlushTailRef = useRef<Promise<unknown>>(Promise.resolve());

    /** Kirim antrean satu per satu; hapus hanya sesudah server mengakuinya. */
    const flushSecurityEvents = useCallback(async (deferTerminationReload = false): Promise<{
        warningCount: number;
        maxViolations: number | null;
        terminated: boolean;
    } | null> => {
        const run = async () => {
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
                if (event.screenshotBase64) {
                    const screenshotDone = await uploadScreenshot(
                        att.id,
                        event.id,
                        getDeviceId(),
                        event.screenshotBase64,
                    );
                    if (!screenshotDone) {
                        // Catatan pelanggaran sudah diakui server (idempoten berdasarkan event.id),
                        // tetapi pengiriman gambar SS terputus. Pertahankan di antrean lokal
                        // agar otomatis diunggah ulang saat koneksi kembali stabil.
                        break;
                    }
                }
                await removeSecurityEvent(att.id, event.id, event);
                // Sisa antrean TIDAK dibuang walau attempt sudah ditutup: server
                // menyimpannya sebagai bukti susulan dan mengakuinya satu per satu.
                // Yang ditolak (di luar masa ujian) berhenti di sini dan kedaluwarsa sendiri.
            }
            if (latest && attemptRef.current?.id === att.id && !submissionSucceededRef.current) {
                violationCountRef.current = latest.warningCount;
                setViolationCount(latest.warningCount);
                if (latest.terminated && !deferTerminationReload && !frozenSnapshotRef.current) {
                    await clearCbtSession();
                    window.location.reload();
                }
            }
            return latest;
        };
        const next = securityFlushTailRef.current.catch(() => null).then(run);
        securityFlushTailRef.current = next;
        return next;
    }, [uploadScreenshot]);

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
            setIsOffline(false);
            void (async () => {
                if (!await revalidateOfflineSession()) return;
                setIsOffline(false);
                if (!attemptRef.current?.id) return;
                if (submissionOnly || frozenSnapshotRef.current || clockRef.current.remainingSeconds() <= 0) {
                    // The manifest travels with answers; image retries must not
                    // postpone a frozen submission when the connection returns.
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

    // Setelah pengumpulan ditolak (mis. waktu habis, perlu pemulihan), halaman
    // berhenti mencoba. Bila proktor kemudian membuka Pulihkan, halaman yang masih
    // terbuka dulu tidak menyadarinya dan jendela pemulihan bisa habis sia-sia.
    // Periksa status berkala; begitu dibuka lagi, muat ulang agar terkirim otomatis.
    useEffect(() => {
        const attemptId = attempt?.id;
        if (!submissionIssue || !attemptId || isCompleted) return;
        let active = true;
        // Hanya perubahan dari "tertutup" menjadi "dibuka lagi" yang memicu muat
        // ulang; penolakan saat sesi masih terbuka tidak boleh membuat putaran ulang.
        let seenClosed = false;
        const check = async () => {
            if (!active || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
            const status = await getExamSubmissionStatus(attemptId).catch(() => null);
            if (!active || !status?.success) return;
            const reopened = status.status === 'in_progress' && (status.submissionOnly || status.remainingSeconds > 0);
            if (!reopened) { seenClosed = true; return; }
            if (seenClosed) window.location.reload();
        };
        void check();
        const interval = setInterval(() => { void check(); }, 15_000);
        return () => { active = false; clearInterval(interval); };
    }, [submissionIssue, attempt?.id, isCompleted]);

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

    useEffect(() => {
        if (!attempt?.id || isCompleted || loading || accessDenied || submissionOnly) return;
        return keepExamScreenAwake();
    }, [attempt?.id, isCompleted, loading, accessDenied, submissionOnly]);

    // ── Security event listeners ─────────────────────────────
    useEffect(() => {
        if (!attempt || isCompleted || loading || accessDenied || submissionOnly) return;
        if (exam?.metadata?.is_safe_mode === false && exam?.metadata?.screenshot_enabled !== true) return;

        const handleSecurityViolation = async (type: string) => {
            const shareLost = type === 'screen_share_lost';
            if (submitInFlightRef.current || frozenSnapshotRef.current || terminationReasonRef.current ||
                (screenRequestingRef.current && !shareLost)) return;
            // Selama berbagi layar terputus, pelanggaran TETAP dihitung (tanpa
            // screenshot). Dulu event diabaikan, sehingga "Stop sharing" menjadi
            // jeda bebas untuk mencari jawaban. Tiga detik pertama diabaikan:
            // mengunci layar memutus berbagi layar dan fokus hampir bersamaan.
            if (exam?.metadata?.screenshot_enabled === true && !screenSharingRef.current && !shareLost &&
                Date.now() - shareLostAtRef.current < SCREEN_SHARE_RACE_MS) return;
            const focusOnly = type === 'focus_interruption';
            // Cooldown GLOBAL lintas-jenis, bukan per-jenis: satu aksi pengguna
            // memicu beberapa event sekaligus (alt-tab = blur + visibilitychange,
            // pindah aplikasi bisa sekalian keluar fullscreen). Dedup per-jenis
            // membuat satu aksi terhitung 2-3 pelanggaran dan warning_count di
            // server melampaui batas maksimal.
            if (!focusOnly) {
                if (savedViolationsRef.current.has('violation:cooldown')) return;
                savedViolationsRef.current.add('violation:cooldown');
                setTimeout(() => savedViolationsRef.current.delete('violation:cooldown'), 2000);
            }

            if (!focusOnly) {
                setViolationType(type);
                setShowViolationModal(true);
            }
            const newCount = violationCountRef.current + (focusOnly ? 0 : 1);
            if (!focusOnly) {
                violationCountRef.current = newCount;
                setViolationCount(newCount);
            }

            const createdAt = new Date().toISOString();
            const eventId = createSecurityEventId();
            const event: QueuedSecurityEvent = {
                id: eventId, attemptId: attempt.id, eventType: type,
                metadata: { timestamp: createdAt }, createdAt,
            };
            pendingSecurityEventsRef.current.set(eventId, event);
            try {
                const captured = !focusOnly && exam?.metadata?.screenshot_enabled === true ? captureScreenshot() : Promise.resolve(null);
                let stored = await enqueueSecurityEvent(event);
                const screenshotBlob = await captured;
                let screenshotQueued = false;
                if (screenshotBlob) {
                    const encodedScreenshot = await screenshotBase64(screenshotBlob).catch(() => null);
                    if (encodedScreenshot) {
                        stored = await enqueueSecurityEvent({
                            ...event,
                            screenshotBase64: encodedScreenshot,
                        });
                        screenshotQueued = stored.saved;
                    }
                }
                if (!stored.saved) {
                    setStorageWarning('Event keamanan gagal disimpan di perangkat. Hubungi proktor.');
                }

                if (submissionSucceededRef.current) {
                    if (screenshotQueued) await retryExamEvidence(attempt.id);
                    else if (screenshotBlob) await uploadScreenshot(attempt.id, eventId, getDeviceId(), screenshotBlob);
                    else {
                        const acknowledged = await logSecurityViolation(attempt.id, type, event.metadata, eventId);
                        if (acknowledged.success) await removeSecurityEvent(attempt.id, eventId, event);
                    }
                    return;
                }

                // Dahulukan jawaban bila event lokal ini diperkirakan mencapai
                // ambang. Server tetap menjadi penentu akhir.
                if (!focusOnly && maxViolations !== null && newCount >= maxViolations) {
                    await retryFailedAnswers();
                    beaconPendingAnswers();
                }
                const securityResult = await flushSecurityEvents(true);
                if (!stored.saved && securityResult && screenshotBlob) {
                    await uploadScreenshot(attempt.id, eventId, getDeviceId(), screenshotBlob);
                }
                if (frozenSnapshotRef.current || submissionSucceededRef.current) return;
                if (securityResult?.terminated) {
                    await clearCbtSession();
                    window.location.reload();
                    return;
                }
                const effectiveLimit = securityResult?.maxViolations ?? maxViolations;
                const effectiveCount = securityResult?.warningCount ?? newCount;
                if (!focusOnly && effectiveLimit !== null && effectiveCount >= effectiveLimit) {
                    requireTermination(`Batas ${effectiveLimit} pelanggaran tercapai: ${type}`);
                }
            } catch (err) {
                console.error('Security violation error:', err);
                if (!frozenSnapshotRef.current && !submissionSucceededRef.current && !focusOnly && maxViolations !== null && newCount >= maxViolations) {
                    requireTermination(`Batas ${maxViolations} pelanggaran tercapai: ${type}`);
                }
            } finally {
                pendingSecurityEventsRef.current.delete(eventId);
            }
        };

        const onVisibilityChange = () => {
            if (document.hidden) {
                if (blurTimeout) clearTimeout(blurTimeout);
                handleSecurityViolation('tab_switch');
            }
        };
        
        let blurTimeout: NodeJS.Timeout;
        const onBlur = () => {
            // Memberikan toleransi 5 detik untuk mengabaikan pop-up notifikasi OS singkat
            if (blurTimeout) clearTimeout(blurTimeout);
            blurTimeout = setTimeout(() => {
                // A hidden page already recorded visibilitychange. Screen lock
                // can keep it hidden long after the global cooldown expires.
                if (document.hidden) return;
                handleSecurityViolation('focus_interruption');
            }, 5000);
        };
        const onFocus = () => {
            // Batalkan pelanggaran jika kursor/fokus kembali dalam kurun < 5 detik
            if (blurTimeout) clearTimeout(blurTimeout);
        };

        const onFullscreenChange = () => {
            if (!document.hidden && !hasExamFullscreen()) {
                // OS dialogs may remove fullscreen and focus together. Keep the
                // fullscreen gate, but do not call that a student violation.
                handleSecurityViolation(document.hasFocus() ? 'exit_fullscreen' : 'focus_interruption');
            }
        };
        const onContextMenu = (e: MouseEvent) => e.preventDefault();
        const onShareLost = () => { void handleSecurityViolation('screen_share_lost'); };
        const onKeyDown = (e: KeyboardEvent) => {
            if (
                e.key === 'PrintScreen' ||
                ((e.ctrlKey || e.metaKey) && ['c', 'v', 'u', 's', 'p'].includes(e.key.toLowerCase())) ||
                e.key === 'F12'
            ) {
                e.preventDefault();
                handleSecurityViolation('restricted_shortcut');
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        const unsubscribeFullscreen = subscribeExamFullscreen(onFullscreenChange);
        document.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener(SCREEN_SHARE_LOST_EVENT, onShareLost);

        return () => {
            window.removeEventListener(SCREEN_SHARE_LOST_EVENT, onShareLost);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            if (blurTimeout) clearTimeout(blurTimeout);
            unsubscribeFullscreen();
            document.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [attempt, isCompleted, loading, user, profile, exam, accessDenied, submissionOnly, examId, flushSecurityEvents, requireTermination, maxViolations, retryFailedAnswers, beaconPendingAnswers, captureScreenshot, uploadScreenshot, screenSharingRef, screenRequestingRef]);

    useEffect(() => {
        if (!attempt || isCompleted || submissionOnly || exam?.metadata?.screenshot_enabled !== true) return;
        if (screenshots.sharing) { wasScreenSharing.current = true; shareLostAtRef.current = 0; return; }
        if (!wasScreenSharing.current) return;
        wasScreenSharing.current = false;
        shareLostAtRef.current = Date.now();
        const event: QueuedSecurityEvent = { id: createSecurityEventId(), attemptId: attempt.id, eventType: 'SCREEN_SHARE_STOPPED',
            metadata: { reason: 'Berbagi layar terhenti atau gambar layar tidak tersedia' }, createdAt: new Date().toISOString() };
        pendingSecurityEventsRef.current.set(event.id, event);
        void enqueueSecurityEvent(event).then(() => flushSecurityEvents())
            .catch(() => setStorageWarning('Catatan berbagi layar belum berhasil disimpan. Hubungi proktor.'))
            .finally(() => pendingSecurityEventsRef.current.delete(event.id));
    }, [attempt, isCompleted, submissionOnly, exam, screenshots.sharing, flushSecurityEvents]);

    // Pengerjaan dikunci selama berbagi layar terputus (waktu tetap berjalan).
    // Bila tidak dipulihkan dalam masa toleransi, satu pelanggaran dicatat per
    // kejadian putus; hitung mundurnya ditampilkan di layar penghalang.
    useEffect(() => {
        const active = Boolean(attempt) && !isCompleted && !submissionOnly && exam?.metadata?.screenshot_enabled === true;
        if (!active || screenshots.sharing || !shareLostAtRef.current) {
            setShareGraceLeft(null);
            return;
        }
        let reported = false;
        const tick = () => {
            const left = Math.max(0, Math.ceil((shareLostAtRef.current + SCREEN_SHARE_GRACE_MS - Date.now()) / 1000));
            setShareGraceLeft(left);
            if (left === 0 && !reported && !screenSharingRef.current) {
                reported = true;
                window.dispatchEvent(new Event(SCREEN_SHARE_LOST_EVENT));
            }
        };
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [attempt, isCompleted, submissionOnly, exam, screenshots.sharing, screenSharingRef]);

    // Laporkan perubahan status berbagi layar ke server SEKARANG, bukan menunggu
    // heartbeat 15 detik: server menolak jawaban baru selama layar tidak dibagikan,
    // dan jawaban yang sempat tertolak dikirim ulang begitu pulih.
    useEffect(() => {
        if (!attempt?.id || isCompleted || submissionOnly || exam?.metadata?.screenshot_enabled !== true) return;
        const attemptId = attempt.id;
        const sharing = screenshots.sharing;
        void heartbeatExamAttempt(attemptId, undefined, sharing, attemptRef.current?.started_at).then(result => {
            if (sharing && result?.success && attemptRef.current?.id === attemptId) void retryFailedAnswers();
        }).catch(() => undefined);
    }, [attempt?.id, isCompleted, submissionOnly, exam?.metadata?.screenshot_enabled, screenshots.sharing, retryFailedAnswers]);

    // Retry berkala untuk autosave dan bukti keamanan yang masih mengantre.
    // `navigator.onLine` dapat tetap true ketika server sempat tidak terjangkau,
    // sehingga jangan hanya mengandalkan event browser `online`.
    useEffect(() => {
        if (!attempt?.id || isCompleted || accessDenied || submissionOnly) return;
        const iv = setInterval(() => {
            retryFailedAnswers();
            void flushSecurityEvents().catch(() => null);
        }, 15000);
        return () => clearInterval(iv);
    }, [attempt?.id, isCompleted, accessDenied, submissionOnly, retryFailedAnswers, flushSecurityEvents]);

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
            const heartbeatStarted = performance.now();
            const heartbeat = await heartbeatExamAttempt(attempt.id, {
                localAnswerCount: Object.values(answersRef.current).filter(value => value.trim().length > 0).length,
                pendingAnswerCount: new Set([...failedSyncRef.current, ...inFlightRef.current]).size,
                storageState: storageStateRef.current,
                ...(report ? { interruption: report } : {}),
                // Alasan penolakan terakhir, supaya pengawas tahu jawaban tertahan
                // walau jaringan siswa normal.
                ...(syncRejectionRef.current ? { rejection: syncRejectionRef.current.slice(0, 200) } : {}),
            }, exam?.metadata?.screenshot_enabled === true ? screenSharingRef.current : undefined,
            attempt.started_at).catch(() => undefined);
            if (cancelled) return;
            if (heartbeat?.success && (heartbeat.restartRequired ||
                (heartbeat.personalEndTime && heartbeat.personalEndTime !== attempt.personal_end_time))) {
                window.location.reload();
                return;
            }
            if (heartbeat?.success) {
                networkSampleRef.current = sampleExamNetwork(networkSampleRef.current, performance.now() - heartbeatStarted);
                setIsNetworkWeak(networkSampleRef.current.weak);
                if (navigator.onLine && connectionReportRef.current === report) setServerUnavailableAt(null);
                if (report && connectionReportRef.current === report) {
                    connectionReportRef.current = null;
                    try { localStorage.removeItem(`exam_connection_${attempt.id}`); } catch { /* Optional telemetry. */ }
                }
                // Sesi sudah berlaku lagi (mis. setelah login ulang di tab lain).
                if (syncRejectionRef.current === SESSION_ENDED_MESSAGE) setSyncRejection(null);
            } else if (heartbeat && !heartbeat.success && heartbeat.retryable === false) {
                // Server menjawab tetapi menolak: ini bukan gangguan jaringan.
                noteSyncResult(heartbeat);
            } else recordConnectionInterruption('server_unreachable');
            if (heartbeat?.success && heartbeat.submissionOnly) {
                setSubmissionOnly(true);
                // Proktor mengubah sesi berjalan menjadi "kirim jawaban saja":
                // kunci dan kirim salinan perangkat sekarang, jangan menunggu klik.
                if (Object.keys(answersRef.current).length > 0) setWaitingForSyncAndSubmit(true);
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
    }, [attempt, isCompleted, accessDenied, submissionOnly, flushSecurityEvents, confirmPendingTermination, recordConnectionInterruption,
        noteSyncResult, exam?.metadata?.screenshot_enabled, screenSharingRef]);

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

        void (async () => {
            // Proktor mungkin baru mengatur ulang waktu. Periksa jam server
            // sebelum membekukan jawaban pada tenggat lama di browser.
            const status = await getExamSubmissionStatus(attempt.id).catch(() => null);
            if (status?.success) {
                if (status.startedAt && status.startedAt !== attempt.started_at) {
                    window.location.reload();
                    return;
                }
                if (status.remainingSeconds > 0) {
                    window.location.reload();
                    return;
                }
            }
            await handleSubmitExam(undefined, { isAuto: true });
        })();
    }, [timeLeft, isOffline, submitting, isCompleted, user, attempt, loading, accessDenied, handleSubmitExam]);



    const handleAnswerSelect = useCallback(async (questionId: string, answer: string | string[]) => {
        if (!ownsEditorLockRef.current) return;
        if (exam?.metadata?.screenshot_enabled === true && !screenSharingRef.current) return;
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
            assignmentData: assignmentRef.current, assignmentRevision: assignmentRevisionRef.current,
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
                const res = await saveAnswerAction(att.id, questionId, payload, att.started_at);
                noteSyncResult(res);
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, !res?.success);
            } catch {
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [markFailed, noteSyncResult, submissionOnly, exam?.metadata?.screenshot_enabled, screenSharingRef]);

    const toggleDoubtful = useCallback(async (questionId: string) => {
        if (!ownsEditorLockRef.current) return;
        if (exam?.metadata?.screenshot_enabled === true && !screenSharingRef.current) return;
        if (submissionOnly || frozenSnapshotRef.current || submitInFlightRef.current || clockRef.current.remainingSeconds() <= 0) return;
        const revision = (revisionsRef.current[questionId] ?? 0) + 1;
        revisionsRef.current[questionId] = revision;
        const newDoubtful = new Set(doubtfulRef.current);
        if (newDoubtful.has(questionId)) {
            newDoubtful.delete(questionId);
        } else {
            newDoubtful.add(questionId);
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
            assignmentData: assignmentRef.current, assignmentRevision: assignmentRevisionRef.current,
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
                const res = await saveAnswerAction(att.id, questionId, payload, att.started_at);
                noteSyncResult(res);
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, !res?.success);
            } catch {
                if (revisionsRef.current[questionId] === revision) markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [markFailed, noteSyncResult, submissionOnly, exam?.metadata?.screenshot_enabled, screenSharingRef]);

    const handleRequestFullscreen = useCallback(async () => {
        // API yang tidak tersedia tetap memiliki jalur kompatibilitas; jika
        // tersedia, status layar penuh harus sesuai keadaan browser sebenarnya.
        try {
            const el = document.documentElement as FullscreenElement;
            const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
            if (request) {
                await request.call(el);
            }
        } catch {
            // Keep the overlay visible when a supported fullscreen request fails.
        }
        setIsFullScreen(hasExamFullscreen() || !supportsExamFullscreen());
    }, []);

    const safeMode = exam?.metadata?.is_safe_mode !== false;
    const screenShareBlocked = exam?.metadata?.screenshot_enabled === true && !screenshots.sharing && !isCompleted && !submissionOnly;
    const networkLabel = examNetworkLabel(isOffline, !!serverUnavailableAt, isNetworkWeak);
    const syncNotice = networkLabel
        ? { tone: 'amber' as const, text: networkLabel,
            details: `Waktu tetap berjalan. Jangan tutup halaman. ${Object.keys(answers).length} jawaban tersedia di perangkat; sinkronisasi jawaban dicoba otomatis. Status ini tidak memastikan semua jawaban sudah tersimpan di server. ${storageWarning || ''}` }
        : syncRejection === SESSION_ENDED_MESSAGE
            ? { tone: 'red' as const, text: 'Sesi login berakhir — jawaban belum terkirim', details: syncRejection }
        : failedSyncCount > 0 && syncRejection
            ? { tone: 'red' as const, text: `${failedSyncCount} jawaban ditolak server`,
                details: `${syncRejection} Jawaban tetap tersimpan di perangkat ini. Jangan tutup halaman dan segera hubungi pengawas.` }
        : failedSyncCount > 0
            ? { tone: 'amber' as const, text: `${failedSyncCount} jawaban menunggu sinkronisasi`, details: 'Pengiriman dicoba kembali otomatis. Jangan tutup halaman sampai jawaban tersimpan di server.' }
            : recoverySummary
                ? { tone: 'blue' as const, text: 'Pemulihan pengumpulan aktif', details: `Lokal: ${recoverySummary.localCount} jawaban · Server: ${recoverySummary.serverCount} jawaban. Batas pemulihan: ${new Date(recoverySummary.recoveryUntil).toLocaleString('id-ID')}.` }
                : storageWarning ? { tone: 'amber' as const, text: 'Penyimpanan perangkat perlu diperiksa', details: storageWarning }
                    : updatedQuestionIds.size > 0 ? { tone: 'blue' as const, text: `${updatedQuestionIds.size} soal diperbarui oleh guru`, details: 'Periksa kembali soal yang ditandai diperbarui sebelum mengumpulkan.' } : null;

    // ── Main Exam UI ───────────────────────────────────────────
    if (loading) {
        return <ExamPageSkeleton />;
    }

    if (awaitingStart && !accessDenied && exam) {
        return <ExamStartPreparation
            key={examId}
            exam={exam}
            screenShare={{ sharing: screenshots.sharing, busy: screenshots.busy, error: screenshots.error, supported: screenshots.supported, request: screenshots.requestShare }}
            onBack={() => router.push('/dashboard/siswa/schedule')}
            onConfirm={(fullscreenReady) => {
                setIsFullScreen(fullscreenReady);
                setLoading(true);
                setAwaitingStart(false);
                confirmedStartExamIdRef.current = examId;
                void fetchExamDataRef.current?.();
            }}
        />;
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
                        {isAlreadyFinished ? 'Ujian Telah Selesai' : accessError.includes('Salinan jawaban berbeda') ? 'Pengumpulan Perlu Diperiksa' : 'Ujian Belum Dapat Dibuka'}
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

    if (submissionIssue) {
        return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-xl bg-white p-8 border border-amber-200">
                <h1 className="text-xl font-bold mb-3">Pengumpulan Perlu Diperiksa</h1>
                <p className="text-sm text-slate-600 mb-4">{submissionIssue}</p>
                <p className="text-sm text-slate-600 mb-5">Mengirim ulang tidak membuka waktu pengerjaan. Jika ada jawaban lokal yang belum diterima setelah waktu habis, minta proktor membuka pemulihan pada perangkat ini.</p>
                <button disabled={submitting} onClick={() => void handleSubmitExam()} className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50">Periksa dan Kirim Ulang</button>
            </div>
        </div>;
    }

    if (submissionOnly && !waitingForSyncAndSubmit) {
        return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-xl bg-white p-8 text-center border border-slate-200">
                <h1 className="text-xl font-bold mb-3">Jawaban Terkunci</h1>
                <p className="text-slate-600 mb-5">Anda hanya dapat mengirim jawaban yang sudah tersimpan. Jawaban dan lampiran tidak dapat diubah.</p>
                {recoverySummary && <p className="text-sm text-slate-500 mb-4">Lokal: {recoverySummary.localCount} jawaban · Server: {recoverySummary.serverCount} jawaban.</p>}
                {recoverySummary && <p className="text-sm font-semibold text-amber-700 mb-4">Kirim sebelum pukul {new Date(recoverySummary.recoveryUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Setelah itu ujian ditutup kembali.</p>}
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
                        Memastikan Pengumpulan Jawaban
                    </h1>
                    <p className="text-slate-300 mb-6 text-base leading-relaxed">
                        Pengumpulan belum dapat dikonfirmasi. Jawaban mungkin sudah tersimpan di server. Sistem akan memeriksa ulang dan mengirim salinan yang sama bila diperlukan setelah koneksi tersedia. <br/><strong>Tetap buka halaman ini sampai pengumpulan terkonfirmasi.</strong>
                    </p>
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-amber-400 bg-amber-500/10 py-3 rounded-lg border border-amber-500/20">
                        <RefreshCw size={16} className="animate-spin" />
                        Memeriksa dan mengonfirmasi saat terhubung...
                    </div>
                    {recoverySummary && (
                        <p className="mt-4 text-sm text-slate-300">
                            Lokal: {recoverySummary.localCount} jawaban · Server: {recoverySummary.serverCount} jawaban.
                            Batas pemulihan pukul {new Date(recoverySummary.recoveryUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.
                        </p>
                    )}
                    {storageWarning && <p className="mt-4 text-sm text-amber-300">{storageWarning}</p>}
                </div>
            </div>
        );
    }

    return (
        <>
            {screenShareBlocked && (
                <div role="dialog" aria-modal="true" aria-label="Bagikan kembali layar" className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/90 p-5">
                    <div className="max-w-md rounded-2xl bg-white p-6 text-center text-slate-900">
                        <h2 className="text-lg font-bold">Bagikan kembali seluruh layar</h2>
                        <p className="mt-2 text-sm">Berbagi layar wajib aktif sampai ujian selesai. Pengerjaan dikunci sementara; jawaban tetap tersimpan dan <strong>waktu ujian tetap berjalan</strong>.</p>
                        {shareGraceLeft !== null && (
                            <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${shareGraceLeft > 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>
                                {shareGraceLeft > 0
                                    ? `Bagikan kembali dalam ${shareGraceLeft} detik, atau kejadian ini dicatat sebagai pelanggaran.`
                                    : 'Berbagi layar terlalu lama terputus dan telah dicatat sebagai pelanggaran. Pindah tab atau aplikasi selama layar terkunci juga tetap dihitung.'}
                            </p>
                        )}
                        {screenshots.supported === false && <p className="mt-2 text-sm font-medium text-amber-700">Browser/perangkat ini tidak menyediakan berbagi layar. Gunakan komputer dengan browser desktop atau hubungi pengawas. Waktu ujian tetap berjalan.</p>}
                        {screenshots.error && <p role="alert" className="mt-2 text-sm text-red-600">{screenshots.error}</p>}
                        <button type="button" disabled={screenshots.busy || screenshots.supported === false} onClick={() => void screenshots.requestShare()} className="mt-4 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50">Bagikan Layar</button>
                    </div>
                </div>
            )}
            <div inert={screenShareBlocked} aria-hidden={screenShareBlocked || undefined} className={screenShareBlocked ? 'invisible' : undefined}>
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
            onNavigate={index => {
                if (exam?.metadata?.screenshot_enabled !== true || screenSharingRef.current) setCurrentQIndex(index);
            }}
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
            syncNotice={syncNotice}
            isAssignment={exam?.exam_type === 'assignment'}
            assignmentData={exam?.metadata}
            examId={examId}
            userId={user?.id}
            assignmentFileUrls={assignmentFileUrls}
            assignmentTextNote={assignmentTextNote}
            assignmentDocumentUrl={assignmentDocumentUrl}
            onAssignmentFilesChange={fileUrls => updateAssignment({ fileUrls })}
            onAssignmentTextChange={textSubmission => updateAssignment({ textSubmission })}
            onAssignmentDocumentChange={documentUrl => updateAssignment({ documentUrl })}
            updatedQuestionIds={updatedQuestionIds}
            onClearUpdated={(qId) => {
                setUpdatedQuestionIds(prev => {
                    const next = new Set(prev);
                    next.delete(qId);
                    return next;
                });
            }}
        />
            </div>
        </>
    );
}
