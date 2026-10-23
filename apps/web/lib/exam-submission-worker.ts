import type { ExamAnswerSnapshot, ExamSubmissionRegistration } from './exam-durable-storage';
import { ExamSnapshotConflictError } from './exam-durable-storage';

export interface SubmissionStatus {
    success: boolean; error?: string; retryable?: boolean;
    examId?: string; status?: string; startedAt?: string; personalEndTime?: string;
    remainingSeconds?: number; submissionOnly?: boolean; canRecover?: boolean;
}
export interface SubmissionResult { success: boolean; error?: string; retryable?: boolean; savedAnswersOnly?: boolean; submissionVerified?: boolean; alreadySubmitted?: boolean }
export interface SubmissionWorkerDependencies {
    online(): boolean;
    now(): number;
    activeExamId(): string | null;
    list(): Promise<ExamSubmissionRegistration[]>;
    currentUser(): Promise<{ id: string } | null>;
    currentDevice(): Promise<string>;
    read(attemptId: string): Promise<ExamAnswerSnapshot | null>;
    status(attemptId: string): Promise<SubmissionStatus>;
    assignment(attemptId: string): ExamAnswerSnapshot['assignmentData'];
    freeze(attemptId: string, snapshot: ExamAnswerSnapshot): Promise<ExamAnswerSnapshot>;
    send(entry: ExamSubmissionRegistration, snapshot: ExamAnswerSnapshot): Promise<SubmissionResult>;
    confirm(entry: ExamSubmissionRegistration, snapshot: ExamAnswerSnapshot): Promise<void>;
    notify?(entry: ExamSubmissionRegistration, result: SubmissionResult): void;
    /** Buang salinan generasi lama setelah server memulai ujian susulan. */
    discard?(entry: ExamSubmissionRegistration): Promise<void>;
}

/**
 * Kegagalan jaringan dicoba cepat; penolakan yang hanya dapat dibuka proktor
 * (waktu habis, sesi dihentikan) cukup diperiksa berkala. Dulu keduanya diulang
 * tiap menit tanpa henti selama tab terbuka.
 */
export function submissionRetryDelay(count: number, retryable: boolean | undefined): number {
    if (retryable === false) return [120_000, 300_000, 600_000][Math.min(count - 1, 2)];
    return Math.min(15_000 * 2 ** Math.min(count - 1, 2), 60_000);
}

/** Independent of React routes; deliberately never opens an exam or creates an attempt. */
export function createExamSubmissionWorker(deps: SubmissionWorkerDependencies) {
    let running: Promise<void> | null = null;
    let stopped = false;
    const failures = new Map<string, { count: number; nextAt: number; error?: string }>();
    const defer = (entry: ExamSubmissionRegistration, result: SubmissionResult) => {
        const previous = failures.get(entry.attemptId);
        const count = (previous?.count || 0) + 1;
        failures.set(entry.attemptId, { count, error: result.error,
            nextAt: deps.now() + submissionRetryDelay(count, result.retryable) });
        if (result.retryable === false && previous?.error !== result.error) deps.notify?.(entry, result);
    };
    const work = async () => {
        if (stopped || !deps.online()) return;
        const entries = await deps.list();
        if (!entries.length || stopped) return;
        // Fresh authentication, not the UI's stale-user fallback after a failed request.
        const user = await deps.currentUser();
        if (!user || stopped) return;
        const device = await deps.currentDevice();
        for (const entry of entries) {
            if (stopped || !deps.online()) break;
            if (entry.userId !== user.id || entry.deviceId !== device || entry.examId === deps.activeExamId()) continue;
            if ((failures.get(entry.attemptId)?.nextAt || 0) > deps.now()) continue;
            try {
                let snapshot = await deps.read(entry.attemptId);
                if (!snapshot) continue;
                const status = await deps.status(entry.attemptId);
                if (!status.success) { defer(entry, status); continue; }
                // Ujian susulan memulai generasi baru (started_at baru) dan sudah
                // menghapus jawaban lama di server; salinan lama tidak berguna lagi.
                if (deps.discard && status.examId === entry.examId &&
                    Date.parse(status.startedAt || '') > Date.parse(entry.startedAt)) {
                    await deps.discard(entry);
                    failures.delete(entry.attemptId);
                    continue;
                }
                if (status.examId !== entry.examId || Date.parse(status.startedAt || '') !== Date.parse(entry.startedAt) || !status.canRecover) {
                    defer(entry, { success: false, retryable: false, error: 'Sesi ujian sudah berubah atau dihentikan. Salinan jawaban tetap disimpan.' });
                    continue;
                }
                // A closed attempt is checked against the server instead of reported as a
                // failure: when the server already holds these answers the copy is confirmed
                // and removed; otherwise the server reports how many answers differ.
                // The server clock prevents an advanced device clock from closing an active exam.
                if (!snapshot.frozenSubmission && status.status === 'in_progress' &&
                    (status.remainingSeconds ?? Infinity) > 0 && !status.submissionOnly) continue;
                if (snapshot.frozenSubmission && Date.parse(snapshot.frozenSubmission.startedAt) !== Date.parse(entry.startedAt)) continue;
                if (stopped || entry.examId === deps.activeExamId()) continue;
                snapshot = await deps.freeze(entry.attemptId, snapshot.frozenSubmission ? snapshot : {
                    ...snapshot,
                    frozenSubmission: { startedAt: entry.startedAt, personalEndTime: entry.personalEndTime },
                    assignmentData: snapshot.assignmentData || (entry.assignment ? deps.assignment(entry.attemptId) : undefined),
                });
                // Account changes while the status request was in flight must not send another user's payload.
                const stillUser = await deps.currentUser();
                if (stopped || stillUser?.id !== entry.userId || !deps.online() || entry.examId === deps.activeExamId()) continue;
                const result = await deps.send(entry, snapshot);
                if (!result.success || result.savedAnswersOnly || result.submissionVerified !== true) {
                    defer(entry, result.success ? { success: false, retryable: false,
                        error: 'Pengumpulan belum terverifikasi lengkap. Salinan lokal tetap disimpan untuk pemeriksaan proktor.' } : result);
                    continue;
                }
                await deps.confirm(entry, snapshot);
                failures.delete(entry.attemptId);
                deps.notify?.(entry, result);
            } catch (error) {
                // A storage/network fault on one attempt must not prevent delivery of the next.
                defer(entry, { success: false, retryable: !(error instanceof ExamSnapshotConflictError),
                    ...(error instanceof ExamSnapshotConflictError ? { error: error.message } : {}) });
            }
        }
    };
    return {
        run(): Promise<void> {
            if (running) return running;
            running = work().catch(() => { /* Offline/auth/storage unavailable: retry on the next trigger. */ })
                .finally(() => { running = null; });
            return running;
        },
        stop() { stopped = true; },
    };
}
