"use client";
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import { getDeviceId, setDeviceId } from '@/lib/device-id';
import { clearCbtSession } from '@/lib/session-reset';
import { submitExamAction, startExamAttemptAction, saveAnswerAction, syncAnswersBulkAction, getExamQuestionsAction, getExamForAttempt, type StudentProfile } from '@/lib/api/students';
import { PerKeyQueue } from '@/lib/per-key-queue';
import { examAutoRetryDelay } from '@/lib/exam-retry';
import {
    createSecurityEventId,
    enqueueSecurityEvent,
    inspectExamStorage,
    readExamSnapshot,
    readSecurityEvents,
    removeExamSnapshot,
    removeSecurityEvent,
    resolveDurableDeviceId,
    writeExamSnapshot,
} from '@/lib/exam-durable-storage';
import { heartbeatExamAttempt, logSecurityViolation, forceTerminateAttempt } from '@/lib/api/proctoring';
import { ExamPageSkeleton } from '@/app/components/ui/SkeletonPatterns';
import { useToast } from '@/app/components/ui/Toast';
import { ExamViewer } from './ExamViewer';

const MAX_VIOLATIONS = 3;

// Tipe yang jawabannya disimpan di kolom essay_answer (JSON/teks), bukan
// selected_option_id. WAJIB sama dengan daftar di submitExamAction — dulu
// handleAnswerSelect memakai daftar lebih pendek (tanpa likert/checklist/
// ranking/ordering) sehingga auto-save tipe tersebut menulis JSON ke kolom
// uuid dan gagal diam-diam; jawaban baru terekam saat submit saja.
const COMPLEX_TYPES = ['essay', 'esay', 'uraian', 'mcq_complex', 'true_false', 'categorization', 'matching', 'short_answer', 'likert', 'checklist', 'ranking', 'ordering'];

/** Petakan satu jawaban ke kolom cbt_answers yang benar untuk tipe soalnya. */
function answerColumns(question: any, ansVal: string | undefined, isDoubtful: boolean) {
    const isComplex = question ? COMPLEX_TYPES.includes(question.type) : false;
    return {
        selected_option_id: isComplex ? undefined : (ansVal || undefined),
        essay_answer: isComplex ? (ansVal || undefined) : undefined,
        is_doubtful: isDoubtful,
    };
}

/** Bentuk baris untuk sinkronisasi jawaban massal. */
function answerRow(question: any, questionId: string, ansVal: string | undefined, isDoubtful: boolean) {
    return { questionId, ...answerColumns(question, ansVal, isDoubtful) };
}

export default function ExamPage() {
    const params = useParams();
    const router = useRouter();
    const examId = params.id as string;

    // Core State
    const [user, setUser] = useState<any>(null);
    // Student identity for the exam header. The auth user only carries an email;
    // the real full_name + NISN (identity_number) live in cbt_profiles.
    const [profile, setProfile] = useState<StudentProfile | null>(null);
    const [exam, setExam] = useState<any>(null);
    const [isCompleted, setIsCompleted] = useState(false);
    const [questions, setQuestions] = useState<any[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [doubtfulAnswers, setDoubtfulAnswers] = useState<Set<string>>(new Set());
    const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    // Cermin ref dari state jawaban. Interval retry, handler `pagehide`, dan
    // flush sebelum force-logout berjalan di luar siklus render, jadi mereka
    // tidak boleh membaca closure state yang bisa basi.
    const answersRef = useRef<Record<string, string>>({});
    const doubtfulRef = useRef<Set<string>>(new Set());
    const questionsRef = useRef<any[]>([]);
    const attemptRef = useRef<any>(null);
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
    const [attempt, setAttempt] = useState<any>(null);
    const [assignmentFileUrls, setAssignmentFileUrls] = useState<string[]>([]);
    const [assignmentTextNote, setAssignmentTextNote] = useState('');

    // UI State
    const [accessDenied, setAccessDenied] = useState(false);
    const [accessError, setAccessError] = useState('');

    // Offline Tolerance
    const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
    const [waitingForSyncAndSubmit, setWaitingForSyncAndSubmit] = useState(false);
    const [recoverySummary, setRecoverySummary] = useState<{
        localCount: number;
        serverCount: number;
        recoveryUntil: string;
    } | null>(null);
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
    const toast = useToast();

    // ── Sinkronisasi ref ──────────────────────────────────────
    useEffect(() => { answersRef.current = answers; }, [answers]);
    useEffect(() => { doubtfulRef.current = doubtfulAnswers; }, [doubtfulAnswers]);
    useEffect(() => { questionsRef.current = questions; }, [questions]);
    useEffect(() => { attemptRef.current = attempt; }, [attempt]);
    useEffect(() => { violationCountRef.current = violationCount; }, [violationCount]);

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
            questionsRef.current.find((q: any) => q.id === qId),
            qId,
            answersRef.current[qId],
            doubtfulRef.current.has(qId),
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
        if (!att?.id || failedSyncRef.current.size === 0) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;

        const ids = Array.from(failedSyncRef.current);
        const rows = ids.map(qId => answerRow(
            questionsRef.current.find((q: any) => q.id === qId),
            qId,
            answersRef.current[qId],
            doubtfulRef.current.has(qId),
        ));
        try {
            const res = await syncAnswersBulkAction(att.id, rows);
            if (res?.success) {
                ids.forEach(id => failedSyncRef.current.delete(id));
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
        if (!att?.id) return;
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
                const authUser = await getSessionUser();
                if (!authUser) {
                    setAccessDenied(true);
                    setAccessError('Silakan login terlebih dahulu.');
                    setLoading(false);
                    return;
                }
                setUser(authUser);

                // Keterangan ujian dan identitas peserta datang bersama dalam
                // satu permintaan. Kepala layar menampilkan "Nama • NISN", jadi
                // profilnya memang dibutuhkan di sini — dan mengambil keduanya
                // sekaligus menghemat satu putaran jaringan di awal ujian.
                const detail = await getExamForAttempt(examId);

                if (!detail.success) {
                    setAccessDenied(true);
                    setAccessError(detail.error || 'Ujian tidak ditemukan.');
                    setLoading(false);
                    return;
                }

                if (detail.profile) setProfile(detail.profile);

                const examData = detail.exam;
                setExam(examData);

                // Attempt baru tidak boleh dibuka tanpa tempat menyimpan
                // snapshot jawaban. Uji tulis nyata menangkap mode privat,
                // kebijakan perangkat, dan quota penuh sebelum siswa mulai.
                const storageHealth = await inspectExamStorage();
                if (!storageHealth.available) {
                    setAccessDenied(true);
                    setAccessError(storageHealth.warning || 'Penyimpanan jawaban tidak tersedia.');
                    setLoading(false);
                    return;
                }
                setStorageWarning(storageHealth.warning || null);
                setDeviceId(await resolveDurableDeviceId(getDeviceId()));

                // Get questions from the bank — WAJIB lewat server action.
                // Query langsung dari browser (anon key) membuat RLS bisa
                // memblokir embed opsi secara diam-diam → "soal tanpa opsi".
                let loadedQuestions: any[] = [];
                // Endpoint backend menyatukan `question_bank_id` dan seluruh
                // `cbt_exam_question_sources`; browser tidak boleh menebak
                // sumber hanya dari kolom bank langsung.
                const qRes = await getExamQuestionsAction(examId);
                if (!qRes.success) {
                    console.error('[ExamPage] Failed to load questions:', qRes.error);
                    setAccessDenied(true);
                    setAccessError(qRes.error || 'Gagal memuat soal. Silakan muat ulang halaman.');
                    setLoading(false);
                    return;
                }
                const qData = qRes.questions;
                if (qData && qData.length > 0) {
                    const deduplicatedData = qData.map((q: any) => ({
                        ...q,
                        // Dedup berdasarkan ID, bukan teks. Dedup teks dulu
                        // MENYEMBUNYIKAN opsi yang kebetulan berbunyi sama
                        // dari siswa, padahal grading tetap menghitungnya —
                        // kunci yang tersembunyi jadi mustahil dicentang.
                        bank_question_options: (() => {
                            const opts = q.bank_question_options || [];
                            const seen = new Set<string>();
                            return opts.filter((o: any) => {
                                if (!o?.id) return true;
                                if (seen.has(o.id)) return false;
                                seen.add(o.id);
                                return true;
                            });
                        })().sort((a: any, b: any) => (a.order || 0) - (b.order || 0)),
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
                const result = await startExamAttemptAction(examId, getDeviceId());
                if (!result.success) {
                    const expiredId = (result as any).expiredAttemptId;
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

                setAttempt(result.attempt);
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
                (result.answers || []).forEach((ans: any) => {
                    serverAnswerIds.add(ans.question_id);
                    if (ans.selected_option_id) savedA[ans.question_id] = ans.selected_option_id;
                    else if (ans.essay_answer) savedA[ans.question_id] = ans.essay_answer;
                    if (ans.is_doubtful) savedD.add(ans.question_id);
                });

                try {
                    const parsed = await readExamSnapshot(result.attempt.id);
                    if (parsed) {
                        if (parsed.answers) {
                            localAnswerIds = Object.keys(parsed.answers)
                                .filter(qId => loadedQuestions.some((q: any) => q.id === qId));
                            for (const qId of localAnswerIds) savedA[qId] = parsed.answers[qId];
                        }
                        if (parsed.doubtfulAnswers) {
                            parsed.doubtfulAnswers.forEach((id: string) => savedD.add(id));
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

                setAnswers(savedA);
                setDoubtfulAnswers(savedD);

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
                if (localAnswerIds.length > 0 && navigator.onLine) {
                    const rows = localAnswerIds.map(qId => answerRow(
                        loadedQuestions.find((q: any) => q.id === qId),
                        qId,
                        savedA[qId],
                        savedD.has(qId),
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
                const remaining = Math.max(0, result.remainingSeconds ?? examData.duration_minutes * 60);
                deadlineRef.current = Date.now() + remaining * 1000;
                setTimeLeft(remaining);
            } catch (err: any) {
                console.error("[ExamPage] Error fetching exam:", err);
                setAccessDenied(true);
                setAccessError(err?.message || 'Terjadi kesalahan saat memuat ujian.');
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

    // Auto-submit terus mencoba sampai server mengonfirmasi status final.
    // Backoff berhenti naik pada 30 detik dan hanya satu timer boleh aktif.
    // Server idempoten, jadi respons sukses yang hilang aman untuk diulang.
    const scheduleAutoRetry = useCallback((opts?: { isAuto?: boolean }) => {
        if (!opts?.isAuto) return;
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
        if (!user || submitInFlightRef.current) return;

        const isAssignment = exam?.exam_type === 'assignment';

        // Offline: jangan tembak request yang pasti gagal — masuk mode tunggu;
        // handler 'online' akan sync jawaban lokal lalu submit otomatis.
        // (Tugas/assignment dikecualikan: unggahannya butuh jaringan aktif.)
        if (!navigator.onLine && !isAssignment) {
            setWaitingForSyncAndSubmit(true);
            return;
        }

        if (opts?.isAuto && autoRetryTimerRef.current) {
            clearTimeout(autoRetryTimerRef.current);
            autoRetryTimerRef.current = null;
        }

        submitInFlightRef.current = true;
        setSubmitting(true);
        const assignmentData = isAssignment ? {
            documentUrl: assignmentSubmission?.documentUrl,
            videoUrl: assignmentSubmission?.videoUrl,
            fileUrls: assignmentFileUrls,
            textSubmission: assignmentTextNote,
        } : undefined;

        try {
            // `submitExamAction` membatalkan request setelah 30 detik. Submit
            // selalu membaca ref terbaru agar jawaban yang berimpit dengan
            // timer nol atau event jaringan tidak tertinggal satu render.
            const result = await submitExamAction(
                examId,
                answersRef.current,
                assignmentData,
                attempt?.id,
            );
            if (result.success) {
                autoRetryCountRef.current = 0;
                setIsCompleted(true);
                if (result.savedAnswersOnly) {
                    toast.warning('Waktu ujian berakhir', 'Hanya jawaban yang sudah sampai di server dinilai. Salinan lokal dipertahankan untuk pemulihan dengan persetujuan proktor.');
                } else {
                    toast.success(isAssignment ? 'Tugas berhasil dikumpulkan!' : 'Ujian berhasil disubmit!');
                }
                if (attempt?.id && !result.savedAnswersOnly) {
                    await removeExamSnapshot(attempt.id);
                    try {
                        localStorage.removeItem(`exam_assignment_${attempt.id}`);
                    } catch { /* Server has confirmed the commit; cache cleanup must not change its outcome. */ }
                }
                router.push('/dashboard/siswa/results');
                // keep submitInFlightRef = true so nothing re-submits after success
            } else {
                if (!opts?.isAuto || autoRetryCountRef.current === 0) {
                    toast.error(isAssignment ? 'Gagal mengumpulkan tugas' : 'Gagal submit ujian', result.error || 'Terjadi kesalahan');
                }
                setSubmitting(false);
                setWaitingForSyncAndSubmit(Boolean(opts?.isAuto));
                submitInFlightRef.current = false;
                scheduleAutoRetry(opts);
            }
        } catch (err: any) {
            if (!opts?.isAuto || autoRetryCountRef.current === 0) {
                toast.error('Gagal submit ujian', err?.message || 'Terjadi kesalahan');
            }
            setSubmitting(false);
            setWaitingForSyncAndSubmit(Boolean(opts?.isAuto));
            submitInFlightRef.current = false;
            scheduleAutoRetry(opts);
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

    const syncPendingAnswers = useCallback(async () => {
        const att = attemptRef.current;
        if (!att?.id) return;
        try {
            const parsed = await readExamSnapshot(att.id);
            if (parsed) {
                const answersArray = Object.keys(parsed.answers || {})
                    .filter(qId => questionsRef.current.some((x: any) => x.id === qId))
                    .map(qId => answerRow(
                        questionsRef.current.find((x: any) => x.id === qId),
                        qId,
                        parsed.answers[qId],
                        parsed.doubtfulAnswers ? parsed.doubtfulAnswers.includes(qId) : false,
                    ));

                if (answersArray.length > 0) {
                    const res = await syncAnswersBulkAction(att.id, answersArray);
                    if (res.success) {
                        // Seluruh snapshot durable baru saja dikirim ulang.
                        failedSyncRef.current.clear();
                        setFailedSyncCount(0);
                        toast.success('Tersinkronisasi', 'Jawaban offline telah dikirim.');
                    }
                }
            }
        } catch(e) {
            console.error('Failed to sync answers', e);
        }
    }, [toast]);

    /** Tutup UI hanya setelah server benar-benar mengonfirmasi terminasi. */
    const confirmPendingTermination = useCallback(async (reason: string): Promise<boolean> => {
        const att = attemptRef.current;
        if (!att?.id || terminationInFlightRef.current || !navigator.onLine) return false;
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
    const flushSecurityEvents = useCallback(async (): Promise<number | null> => {
        const att = attemptRef.current;
        if (!att?.id || !navigator.onLine) return null;
        const events = await readSecurityEvents(att.id);
        let serverCount: number | null = null;
        for (const event of events) {
            const result = await logSecurityViolation(
                att.id,
                event.eventType,
                event.metadata,
                event.id,
            );
            if (!result.success) break;
            serverCount = result.warningCount;
            await removeSecurityEvent(att.id, event.id);
        }
        if (serverCount !== null) {
            violationCountRef.current = serverCount;
            setViolationCount(serverCount);
        }
        return serverCount;
    }, []);

    const requireTermination = useCallback((reason: string) => {
        terminationReasonRef.current = reason;
        setTerminationPending(reason);
        void confirmPendingTermination(reason);
    }, [confirmPendingTermination]);

    // ── Network Detection ────────────────────────────────────
    useEffect(() => {
        const handleOnline = () => {
            setIsOffline(false);
            if (attempt?.id) {
                Promise.all([syncPendingAnswers(), flushSecurityEvents()]).then(([, securityCount]) => {
                    if (securityCount !== null && securityCount >= MAX_VIOLATIONS) {
                        requireTermination(terminationReasonRef.current || 'Batas pelanggaran keamanan terlampaui');
                        return;
                    }
                    if (terminationReasonRef.current) {
                        void confirmPendingTermination(terminationReasonRef.current);
                        return;
                    }
                    if (waitingForSyncAndSubmit) {
                        handleSubmitExam(undefined, { isAuto: true });
                    }
                });
            }
        };
        const handleOffline = () => setIsOffline(true);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [attempt, syncPendingAnswers, flushSecurityEvents, requireTermination, confirmPendingTermination, waitingForSyncAndSubmit, handleSubmitExam]);

    // ── Security event listeners ─────────────────────────────
    useEffect(() => {
        if (!attempt || isCompleted || loading || accessDenied) return;
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

                const serverCount = await flushSecurityEvents();
                const effectiveCount = serverCount ?? newCount;
                if (effectiveCount >= MAX_VIOLATIONS) {
                    requireTermination(`Exceeded ${MAX_VIOLATIONS} violations: ${type}`);
                }
            } catch (err) {
                console.error('Security violation error:', err);
                if (newCount >= MAX_VIOLATIONS) {
                    requireTermination(`Exceeded ${MAX_VIOLATIONS} violations: ${type}`);
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
    }, [attempt, isCompleted, loading, user, profile, exam, accessDenied, examId, flushSecurityEvents, requireTermination]);

    // Retry berkala untuk autosave yang gagal. Sebelumnya jawaban yang gagal
    // tersimpan hanya tersusul kalau kebetulan ada event 'online' — kegagalan
    // saat koneksi tetap menyala tidak pernah dicoba ulang sama sekali.
    useEffect(() => {
        if (!attempt?.id || isCompleted || accessDenied) return;
        const iv = setInterval(() => { retryFailedAnswers(); }, 15000);
        return () => clearInterval(iv);
    }, [attempt?.id, isCompleted, accessDenied, retryFailedAnswers]);

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
    }, [attempt?.id, isCompleted, accessDenied, beaconPendingAnswers]);

    // Heartbeat lokal mendeteksi tab yang pernah ditutup; heartbeat server
    // memberi layar pengawas status online/offline yang dapat dipercaya.
    useEffect(() => {
        if (!attempt || isCompleted || accessDenied) return;
        const key = `exam_lastseen_${attempt.id}`;
        const pulse = async () => {
            try { localStorage.setItem(key, String(Date.now())); } catch { /* optional heartbeat */ }
            if (!navigator.onLine) return;
            await heartbeatExamAttempt(attempt.id).catch(() => undefined);
            const securityCount = await flushSecurityEvents().catch(() => null);
            if (securityCount !== null && securityCount >= MAX_VIOLATIONS) {
                requireTermination(terminationReasonRef.current || 'Batas pelanggaran keamanan terlampaui');
            } else if (terminationReasonRef.current) {
                void confirmPendingTermination(terminationReasonRef.current);
            }
        };
        void pulse();
        const iv = setInterval(() => { void pulse(); }, 15000);
        return () => clearInterval(iv);
    }, [attempt, isCompleted, accessDenied, flushSecurityEvents, requireTermination, confirmPendingTermination]);

    // ── Timer ─────────────────────────────────────────────────
    useEffect(() => {
        if (loading || !exam || timeLeft <= 0 || submitting || accessDenied || isCompleted) return;
        const tick = () => {
            // Derive remaining from the absolute deadline so a throttled/background
            // tab cannot slow the countdown.
            const remaining = deadlineRef.current
                ? Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000))
                : 0;
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

        if (isOffline) {
            setTimeout(() => {
                setWaitingForSyncAndSubmit(true);
            }, 0);
        } else {
            setTimeout(() => {
                handleSubmitExam(undefined, { isAuto: true });
            }, 0);
        }
    }, [timeLeft, isOffline, submitting, isCompleted, user, attempt, loading, accessDenied, handleSubmitExam]);



    const handleAnswerSelect = useCallback(async (questionId: string, answer: string | string[]) => {
        const answerStr = Array.isArray(answer) ? answer.join(',') : answer;
        // Baca dari ref, bukan closure state: dua perubahan yang terjadi dalam
        // satu batch render tidak boleh saling menimpa.
        const updatedAnswers = { ...answersRef.current, [questionId]: answerStr };
        answersRef.current = updatedAnswers;
        setAnswers(updatedAnswers);

        const att = attemptRef.current;
        if (!att) return;

        void writeExamSnapshot(att.id, {
            answers: updatedAnswers,
            doubtfulAnswers: Array.from(doubtfulRef.current),
        }).then(result => {
            if (!result.saved) {
                setStorageWarning('Snapshot lokal gagal disimpan. Jangan lanjutkan dalam keadaan offline; hubungi proktor.');
            } else if (result.mode === 'localstorage') {
                setStorageWarning('IndexedDB tidak tersedia. Jangan tutup atau memuat ulang browser saat offline.');
            }
        });

        const q = questionsRef.current.find((x: any) => x.id === questionId);
        // Hasil autosave WAJIB diperiksa. Kegagalan (sesi kedaluwarsa, attempt
        // sudah bukan in_progress, 500 sekejap) ditandai supaya retry berkala
        // dan flush penutupan bisa menyusulkannya.
        inFlightRef.current.add(questionId);
        await saveQueueRef.current.enqueue(questionId, async () => {
            try {
                const res = await saveAnswerAction(att.id, questionId, answerColumns(q, answerStr, doubtfulRef.current.has(questionId)));
                markFailed(questionId, !res?.success);
            } catch {
                markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [markFailed]);

    const toggleDoubtful = useCallback(async (questionId: string) => {
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

        void writeExamSnapshot(att.id, {
            answers: answersRef.current,
            doubtfulAnswers: Array.from(newDoubtful),
        }).then(result => {
            if (!result.saved) {
                setStorageWarning('Snapshot lokal gagal disimpan. Jangan lanjutkan dalam keadaan offline; hubungi proktor.');
            } else if (result.mode === 'localstorage') {
                setStorageWarning('IndexedDB tidak tersedia. Jangan tutup atau memuat ulang browser saat offline.');
            }
        });

        const q = questionsRef.current.find((x: any) => x.id === questionId);
        inFlightRef.current.add(questionId);
        await saveQueueRef.current.enqueue(questionId, async () => {
            try {
                const res = await saveAnswerAction(att.id, questionId, answerColumns(q, answersRef.current[questionId], newDoubtful.has(questionId)));
                markFailed(questionId, !res?.success);
            } catch {
                markFailed(questionId, true);
            }
        });
        if (!saveQueueRef.current.has(questionId)) inFlightRef.current.delete(questionId);
    }, [toast, markFailed]);

    const handleRequestFullscreen = useCallback(() => {
        // Sebagian perangkat (iPhone/iPad Safari, sebagian WebView Android)
        // TIDAK punya requestFullscreen — memanggilnya melempar error sinkron
        // sehingga setIsFullScreen(true) di bawah tidak pernah jalan dan siswa
        // terjebak di layar "Aktifkan Layar Penuh". Fullscreen bersifat
        // best-effort; gerbang harus selalu terbuka setelah tombol ditekan.
        try {
            const el: any = document.documentElement;
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
        // Handle case where exam is already finished or no access
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
                        {isAlreadyFinished ? 'Ujian Telah Selesai' : 'Akses Ditolak'}
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
                        Menunggu koneksi internet pulih untuk mengirim jawaban ujian Anda. Jawaban tersimpan aman di perangkat ini. <br/><strong className="text-rose-400">Mohon jangan tutup atau refresh halaman ini!</strong>
                    </p>
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-amber-400 bg-amber-500/10 py-3 rounded-lg border border-amber-500/20">
                        <RefreshCw size={16} className="animate-spin" />
                        Mencoba terhubung kembali...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            {isOffline && !waitingForSyncAndSubmit && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-rose-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <AlertTriangle size={16} />
                    <span>Koneksi terputus. Jawaban otomatis disimpan di perangkat. Jangan tutup browser.</span>
                </div>
            )}
            {!isOffline && !waitingForSyncAndSubmit && failedSyncCount > 0 && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <RefreshCw size={16} className="animate-spin" />
                    <span>{failedSyncCount} jawaban belum tersimpan ke server. Mencoba mengirim ulang otomatis — jangan tutup halaman.</span>
                </div>
            )}
            {!isOffline && !waitingForSyncAndSubmit && failedSyncCount === 0 && recoverySummary && (
                <div className="fixed top-0 left-0 right-0 z-[10005] bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs md:text-sm font-bold shadow-md animate-in slide-in-from-top">
                    <ShieldCheck size={16} />
                    <span>
                        Pemulihan aktif sampai {new Date(recoverySummary.recoveryUntil).toLocaleString('id-ID')}.
                        {' '}Lokal: {recoverySummary.localCount} jawaban · Server: {recoverySummary.serverCount} jawaban.
                    </span>
                </div>
            )}
            {!isOffline && !waitingForSyncAndSubmit && failedSyncCount === 0 && !recoverySummary && storageWarning && (
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
            studentName={profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Siswa'}
            studentNisn={profile?.identity_number || ''}
            examTitle={exam?.title || ''}
            currentQIndex={currentQIndex}
            onNavigate={setCurrentQIndex}
            timeLeft={timeLeft}
            isSafeMode={safeMode}
            violationCount={violationCount}
            maxViolations={MAX_VIOLATIONS}
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
