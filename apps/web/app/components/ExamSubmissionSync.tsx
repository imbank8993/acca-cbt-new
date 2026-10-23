'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { fetchSessionUser } from '@/lib/session';
import { getDeviceId, setDeviceId } from '@/lib/device-id';
import { getExamSubmissionStatus, submitExamAction } from '@/lib/api/students';
import {
    EXAM_SUBMISSION_QUEUE_CHANGED, listExamSubmissionRegistrations, readExamSnapshot,
    freezeExamSnapshot, resolveDurableDeviceId, removeConfirmedExamSnapshot,
    removeExamSubmissionRegistration, readExamRecoverySession, removeExamRecoverySession, pruneExamRecoverySessions, pruneExpiredSecurityEvents,
    readSecurityEvents, removeSecurityEvent, discardExamLocalCopy, pruneStaleExamCopies, removeExamAttemptCaches,
} from '@/lib/exam-durable-storage';
import { retryExamEvidence } from '@/lib/exam-evidence-outbox';
import { removeExamOfflineShell } from '@/lib/exam-pwa';
import { createExamSubmissionWorker } from '@/lib/exam-submission-worker';
import { useToast } from './ui/Toast';

/** Lives in the root layout so navigation to Dashboard does not stop the queue. */
export function ExamSubmissionSync() {
    const pathname = usePathname();
    const pathRef = useRef(pathname);
    const toast = useToast();
    const toastRef = useRef(toast);
    const runRef = useRef<(() => void) | null>(null);
    useEffect(() => { toastRef.current = toast; }, [toast]);
    useEffect(() => { pathRef.current = pathname; runRef.current?.(); }, [pathname]);
    useEffect(() => {
        const worker = createExamSubmissionWorker({
            online: () => navigator.onLine,
            now: () => performance.now(),
            activeExamId: () => {
                const id = pathRef.current.match(/^\/dashboard\/siswa\/exam\/([^/]+)\/?$/)?.[1];
                return id ? decodeURIComponent(id) : null;
            },
            list: listExamSubmissionRegistrations,
            currentUser: fetchSessionUser,
            currentDevice: async () => {
                const id = await resolveDurableDeviceId(getDeviceId());
                setDeviceId(id);
                return id;
            },
            read: readExamSnapshot,
            status: getExamSubmissionStatus,
            assignment: attemptId => {
                try {
                    const value = JSON.parse(localStorage.getItem(`exam_assignment_${attemptId}`) || '{}');
                    return { fileUrls: Array.isArray(value.fileUrls) ? value.fileUrls : [],
                        textSubmission: typeof value.textNote === 'string' ? value.textNote : '' };
                } catch { return undefined; }
            },
            freeze: freezeExamSnapshot,
            send: async (entry, snapshot) => {
                // Peringatan yang tertahan selama offline ikut dikirim. Tanpa ini,
                // menutup tab lalu membiarkan antrean global yang mengumpulkan
                // membuat seluruh jejak pelanggaran masa offline tidak pernah sampai.
                const queued = await readSecurityEvents(entry.attemptId).catch(() => []);
                const manifest = queued.slice(-100).map(({ id, eventType, metadata, createdAt }) => ({ id, eventType, metadata, createdAt }));
                const result = await submitExamAction(entry.examId, snapshot.answers, snapshot.assignmentData,
                    entry.attemptId, snapshot.revisions, snapshot.frozenSubmission, manifest.length ? manifest : undefined);
                const accepted = new Set(result.acceptedSecurityEventIds || []);
                for (const event of queued) {
                    if (accepted.has(event.id) && !event.screenshotBase64) {
                        await removeSecurityEvent(entry.attemptId, event.id, event).catch(() => undefined);
                    }
                }
                if (queued.some(event => event.screenshotBase64)) void retryExamEvidence(entry.attemptId).catch(() => undefined);
                return result;
            },
            discard: discardExamLocalCopy,
            confirm: async (entry, snapshot) => {
                const current = (await listExamSubmissionRegistrations()).find(item => item.attemptId === entry.attemptId);
                if (current && (current.startedAt !== entry.startedAt || current.personalEndTime !== entry.personalEndTime)) return;
                if (snapshot.frozenSubmission) await removeConfirmedExamSnapshot(entry.attemptId, snapshot.frozenSubmission);
                await removeExamSubmissionRegistration(entry.attemptId, entry.startedAt, entry.personalEndTime);
                const cached = await readExamRecoverySession(entry.examId).catch(() => null);
                if (cached?.attemptId === entry.attemptId && cached.attempt.started_at === entry.startedAt &&
                    cached.attempt.personal_end_time === entry.personalEndTime) {
                    await removeExamRecoverySession(entry.examId).catch(() => undefined);
                    await removeExamOfflineShell(entry.examId).catch(() => undefined);
                }
                removeExamAttemptCaches(entry.attemptId);
            },
            notify: (_entry, result) => {
                if (result.success) {
                    window.dispatchEvent(new Event('exam-submission-synced'));
                    if (/^\/dashboard\/siswa\/exam\//.test(pathRef.current)) return;
                    toastRef.current.success('Jawaban berhasil dikirim', 'Pengiriman otomatis selesai.');
                } else {
                    if (/^\/dashboard\/siswa\/exam\//.test(pathRef.current)) return;
                    toastRef.current.warning('Jawaban belum terkirim', result.error);
                }
            },
        });
        let lastPrune = 0;
        const prune = async () => {
            // Paling sering sekali per menit; perlu user sesi untuk tahu pemiliknya.
            if (Date.now() - lastPrune < 60_000) return;
            lastPrune = Date.now();
            const user = await fetchSessionUser().catch(() => null);
            await pruneExamRecoverySessions(user?.id ?? null).catch(() => undefined);
            await pruneExpiredSecurityEvents().catch(() => undefined);
            await pruneStaleExamCopies().catch(() => undefined);
        };
        const run = () => { void worker.run(); void prune(); };
        const onVisible = () => { if (!document.hidden) run(); };
        runRef.current = run;
        run();
        const timer = window.setInterval(run, 15_000);
        window.addEventListener('online', run);
        window.addEventListener('focus', run);
        window.addEventListener('storage', run);
        window.addEventListener(EXAM_SUBMISSION_QUEUE_CHANGED, run);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            worker.stop();
            runRef.current = null;
            window.clearInterval(timer);
            window.removeEventListener('online', run);
            window.removeEventListener('focus', run);
            window.removeEventListener('storage', run);
            window.removeEventListener(EXAM_SUBMISSION_QUEUE_CHANGED, run);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return null;
}
