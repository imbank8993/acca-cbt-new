import type { AuthUser } from '@acca-cbt/shared';
import type { StudentExam,StudentExamAttempt,StudentExamQuestion } from './api/students';

/**
 * Penyimpanan snapshot jawaban ujian.
 *
 * IndexedDB menyediakan kapasitas utama. localStorage ditulis langsung sebelum
 * operasi async agar input terakhir punya cadangan saat reload. Pemulihan
 * membandingkan revisi kedua salinan, termasuk setelah salah satunya gagal ditulis.
 */

const DATABASE_NAME = 'acca-cbt-exam';
const DATABASE_VERSION = 4;
const SNAPSHOT_STORE = 'answer-snapshots';
const SETTINGS_STORE = 'settings';
const SECURITY_EVENT_STORE = 'security-events';
const RECOVERY_SESSION_STORE = 'recovery-sessions';
const MIN_FREE_BYTES = 5 * 1024 * 1024;

export interface ExamAnswerSnapshot {
    assignmentRevision?: number;
    frozenSubmission?: { startedAt: string; personalEndTime: string };
    assignmentData?: { documentUrl?: string; videoUrl?: string; fileUrls?: string[]; textSubmission?: string };

    answers: Record<string, string>;
    doubtfulAnswers: string[];
    revisions?: Record<string, number>;
}

export interface ExamStorageHealth {
    available: boolean;
    mode: 'indexeddb' | 'localstorage' | 'unavailable';
    persistent: boolean;
    warning?: string;
}

export interface ExamStorageWriteResult {
    saved: boolean;
    mode: 'indexeddb' | 'localstorage' | 'unavailable';
}

export interface QueuedSecurityEvent {
    id: string;
    attemptId: string;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

/**
 * Paket minimum yang sudah diverifikasi server untuk membuka ulang satu attempt
 * ketika perangkat tidak dapat menjangkau server. Paket ini tidak pernah
 * membuat attempt baru dan hanya berisi DTO soal siswa (tanpa kunci jawaban).
 */
export interface ExamRecoverySession {
    examId: string;
    attemptId: string;
    userId: string;
    deviceId: string;
    user: AuthUser;
    profile: { full_name: string | null; identity_number: string | null } | null;
    exam: StudentExam;
    attempt: StudentExamAttempt;
    questions: StudentExamQuestion[];
    deadlineAt: number;
    lastQuestionIndex: number;
    cachedAt: string;
}

export type RecoverySessionValidation =
    | { valid: true; session: ExamRecoverySession }
    | { valid: false; reason: 'missing' | 'exam' | 'user' | 'device' | 'expired' | 'invalid' };

interface StoredSnapshot extends ExamAnswerSnapshot {
    attemptId: string;
    updatedAt: string;
}

let databasePromise: Promise<IDBDatabase> | null = null;
const snapshotTails = new Map<string, Promise<void>>();

function legacyKey(attemptId: string): string {
    return `exam_answers_${attemptId}`;
}

function securityQueueKey(attemptId: string): string {
    return `exam_security_events_${attemptId}`;
}

function normalizeSnapshot(value: unknown): ExamAnswerSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<ExamAnswerSnapshot>;
    if (!row.answers || typeof row.answers !== 'object' || Array.isArray(row.answers)) return null;

    const answers = Object.fromEntries(
        Object.entries(row.answers)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    const doubtfulAnswers = Array.isArray(row.doubtfulAnswers)
        ? row.doubtfulAnswers.filter((id): id is string => typeof id === 'string')
        : [];
    const revisions = row.revisions && typeof row.revisions === 'object'
        ? Object.fromEntries(Object.entries(row.revisions).filter(([, value]) => Number.isSafeInteger(value) && value >= 0))
        : undefined;
    const frozen = row.frozenSubmission;
    const frozenSubmission = frozen && typeof frozen.startedAt === 'string' && typeof frozen.personalEndTime === 'string' &&
        Number.isFinite(Date.parse(frozen.startedAt)) && Number.isFinite(Date.parse(frozen.personalEndTime)) ? frozen : undefined;
    return { answers, doubtfulAnswers, ...(revisions ? { revisions } : {}),
        ...(Number.isSafeInteger(row.assignmentRevision) && row.assignmentRevision! >= 0 ? { assignmentRevision: row.assignmentRevision } : {}),
        ...(frozenSubmission ? { frozenSubmission } : {}),
        ...(row.assignmentData && typeof row.assignmentData === 'object' ? { assignmentData: row.assignmentData } : {}),
    };
}

function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB tidak tersedia'));
            return;
        }

        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
                db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'attemptId' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(SECURITY_EVENT_STORE)) {
                const store = db.createObjectStore(SECURITY_EVENT_STORE, { keyPath: 'id' });
                store.createIndex('attemptId', 'attemptId', { unique: false });
            }
            if (!db.objectStoreNames.contains(RECOVERY_SESSION_STORE)) {
                db.createObjectStore(RECOVERY_SESSION_STORE, { keyPath: 'examId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB gagal dibuka'));
        request.onblocked = () => reject(new Error('IndexedDB sedang terkunci oleh tab lain'));
    });
    const guarded = opening.catch(error => {
        databasePromise = null;
        throw error;
    });
    databasePromise = guarded;
    return guarded;
}

function normalizeRecoverySession(value: unknown): ExamRecoverySession | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<ExamRecoverySession>;
    if (
        typeof row.examId !== 'string' || !row.examId ||
        typeof row.attemptId !== 'string' || !row.attemptId ||
        typeof row.userId !== 'string' || !row.userId ||
        typeof row.deviceId !== 'string' || !row.deviceId ||
        typeof row.deadlineAt !== 'number' || !Number.isFinite(row.deadlineAt) ||
        !row.user || typeof row.user !== 'object' ||
        !row.exam || typeof row.exam !== 'object' ||
        !row.attempt || typeof row.attempt !== 'object' ||
        !Array.isArray(row.questions) ||
        row.user.id !== row.userId ||
        row.exam.id !== row.examId ||
        row.attempt.id !== row.attemptId
    ) return null;

    return {
        examId: row.examId,
        attemptId: row.attemptId,
        userId: row.userId,
        deviceId: row.deviceId,
        user: row.user,
        profile: row.profile && typeof row.profile === 'object'
            ? {
                full_name: typeof row.profile.full_name === 'string' ? row.profile.full_name : null,
                identity_number: typeof row.profile.identity_number === 'string' ? row.profile.identity_number : null,
            }
            : null,
        exam: row.exam,
        attempt: row.attempt,
        questions: row.questions.filter((question) =>
            Boolean(question) && typeof question === 'object' && !Array.isArray(question)),
        deadlineAt: row.deadlineAt,
        lastQuestionIndex: Number.isInteger(row.lastQuestionIndex) && (row.lastQuestionIndex as number) >= 0
            ? row.lastQuestionIndex as number
            : 0,
        cachedAt: typeof row.cachedAt === 'string' ? row.cachedAt : new Date(0).toISOString(),
    };
}

async function recoveryStoreRequest<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(RECOVERY_SESSION_STORE, mode);
        const store = transaction.objectStore(RECOVERY_SESSION_STORE);
        transaction.onabort = () => reject(transaction.error || new Error('Cache pemulihan dibatalkan'));
        transaction.onerror = () => reject(transaction.error || new Error('Cache pemulihan gagal'));
        run(store, resolve, reject);
    });
}

export async function writeExamRecoverySession(
    session: Omit<ExamRecoverySession, 'cachedAt'> & { cachedAt?: string },
): Promise<void> {
    const value: ExamRecoverySession = {
        ...session,
        cachedAt: session.cachedAt || new Date().toISOString(),
    };
    await registerExamSubmission(value);
    await recoveryStoreRequest<void>('readwrite', (store, resolve, reject) => {
        const request = store.put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function readExamRecoverySession(examId: string): Promise<ExamRecoverySession | null> {
    return recoveryStoreRequest<ExamRecoverySession | null>('readonly', (store, resolve, reject) => {
        const request = store.get(examId);
        request.onsuccess = () => resolve(normalizeRecoverySession(request.result));
        request.onerror = () => reject(request.error);
    });
}

export async function updateExamRecoveryPosition(examId: string, lastQuestionIndex: number): Promise<void> {
    await patchExamRecoverySession(examId, current => ({
        ...current, lastQuestionIndex: Math.max(0, Math.floor(lastQuestionIndex)),
    }));
}

/** A single IndexedDB transaction avoids overwriting revisions during navigation or reviving a removed session. */
async function patchExamRecoverySession(
    examId: string, patch: (current: ExamRecoverySession) => ExamRecoverySession,
): Promise<void> {
    await recoveryStoreRequest<void>('readwrite', (store, resolve, reject) => {
        const read = store.get(examId);
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
            const current = normalizeRecoverySession(read.result);
            if (!current) { resolve(); return; }
            const write = store.put(patch(current));
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
        };
    });
}

export async function updateExamRecoveryQuestions(
    examId: string, attemptId: string, questions: ExamRecoverySession['questions'],
): Promise<void> {
    await patchExamRecoverySession(examId, current => current.attemptId === attemptId
        ? { ...current, questions } : current);
}

export async function removeExamRecoverySession(examId: string): Promise<void> {
    await recoveryStoreRequest<void>('readwrite', (store, resolve, reject) => {
        const request = store.delete(examId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/** Hapus paket soal offline saat pengguna memilih logout pada perangkat bersama. */
export async function clearExamRecoverySessions(): Promise<void> {
    await recoveryStoreRequest<void>('readwrite', (store, resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export function validateExamRecoverySession(
    session: ExamRecoverySession | null,
    expected: { examId: string; deviceId: string; userId?: string | null; now?: number; allowExpiredForSubmission?: boolean },
): RecoverySessionValidation {
    if (!session) return { valid: false, reason: 'missing' };
    if (!normalizeRecoverySession(session)) return { valid: false, reason: 'invalid' };
    if (session.examId !== expected.examId) return { valid: false, reason: 'exam' };
    if (expected.userId && session.userId !== expected.userId) return { valid: false, reason: 'user' };
    if (!expected.deviceId || session.deviceId !== expected.deviceId) {
        return { valid: false, reason: 'device' };
    }
    if (session.deadlineAt <= (expected.now ?? Date.now()) && !expected.allowExpiredForSubmission) {
        return { valid: false, reason: 'expired' };
    }
    return { valid: true, session };
}

function readLegacySecurityQueue(attemptId: string): QueuedSecurityEvent[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(securityQueueKey(attemptId)) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is QueuedSecurityEvent =>
            Boolean(item) && typeof item.id === 'string' && item.attemptId === attemptId &&
            typeof item.eventType === 'string' && typeof item.createdAt === 'string' &&
            typeof item.metadata === 'object' && item.metadata !== null,
        );
    } catch {
        return [];
    }
}

function writeLegacySecurityQueue(attemptId: string, events: QueuedSecurityEvent[]): boolean {
    try {
        localStorage.setItem(securityQueueKey(attemptId), JSON.stringify(events));
        return true;
    } catch {
        return false;
    }
}

async function idbPutSecurityEvent(event: QueuedSecurityEvent): Promise<void> {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(SECURITY_EVENT_STORE, 'readwrite');
        const request = transaction.objectStore(SECURITY_EVENT_STORE).put(event);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Antrean keamanan gagal ditulis'));
        transaction.onerror = () => reject(transaction.error || request.error);
    });
}

async function idbReadSecurityEvents(attemptId: string): Promise<QueuedSecurityEvent[]> {
    const db = await openDatabase();
    return new Promise<QueuedSecurityEvent[]>((resolve, reject) => {
        const transaction = db.transaction(SECURITY_EVENT_STORE, 'readonly');
        const request = transaction.objectStore(SECURITY_EVENT_STORE).index('attemptId').getAll(attemptId);
        request.onsuccess = () => resolve((request.result as QueuedSecurityEvent[])
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error || new Error('Antrean keamanan gagal dibaca'));
    });
}

async function idbDeleteSecurityEvent(id: string): Promise<void> {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(SECURITY_EVENT_STORE, 'readwrite');
        const request = transaction.objectStore(SECURITY_EVENT_STORE).delete(id);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Antrean keamanan gagal dihapus'));
    });
}

/** UUID v4 dipakai server sebagai kunci idempoten saat event dicoba ulang. */
export function createSecurityEventId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Simpan event sebelum mencoba jaringan agar offline/reload tidak menghilangkannya. */
export async function enqueueSecurityEvent(event: QueuedSecurityEvent): Promise<ExamStorageWriteResult> {
    const legacy = readLegacySecurityQueue(event.attemptId);
    if (!legacy.some(item => item.id === event.id)) legacy.push(event);
    const mirrored = writeLegacySecurityQueue(event.attemptId, legacy);
    try {
        await idbPutSecurityEvent(event);
        return { saved: true, mode: 'indexeddb' };
    } catch {
        return mirrored
            ? { saved: true, mode: 'localstorage' }
            : { saved: false, mode: 'unavailable' };
    }
}

export async function readSecurityEvents(attemptId: string): Promise<QueuedSecurityEvent[]> {
    const legacy = readLegacySecurityQueue(attemptId);
    try {
        const durable = await idbReadSecurityEvents(attemptId);
        const merged = new Map([...legacy, ...durable].map(event => [event.id, event]));
        return Array.from(merged.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
        return legacy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}

export async function removeSecurityEvent(attemptId: string, id: string): Promise<void> {
    try { await idbDeleteSecurityEvent(id); } catch { /* fallback tetap dibersihkan */ }
    writeLegacySecurityQueue(attemptId, readLegacySecurityQueue(attemptId).filter(event => event.id !== id));
}

async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(SNAPSHOT_STORE, mode);
        const store = transaction.objectStore(SNAPSHOT_STORE);
        transaction.onabort = () => reject(transaction.error || new Error('Transaksi IndexedDB dibatalkan'));
        transaction.onerror = () => reject(transaction.error || new Error('Transaksi IndexedDB gagal'));
        run(store, resolve, reject);
    });
}

async function idbGet(attemptId: string): Promise<ExamAnswerSnapshot | null> {
    return withStore('readonly', (store, resolve, reject) => {
        const request = store.get(attemptId);
        request.onsuccess = () => resolve(normalizeSnapshot(request.result));
        request.onerror = () => reject(request.error);
    });
}

async function idbPut(attemptId: string, snapshot: ExamAnswerSnapshot): Promise<void> {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
        const request = transaction.objectStore(SNAPSHOT_STORE).put({
            attemptId,
            answers: snapshot.answers,
            doubtfulAnswers: snapshot.doubtfulAnswers,
            revisions: snapshot.revisions,
            frozenSubmission: snapshot.frozenSubmission,
            assignmentData: snapshot.assignmentData,
            assignmentRevision: snapshot.assignmentRevision,
            updatedAt: new Date().toISOString(),
        } satisfies StoredSnapshot);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Penulisan IndexedDB dibatalkan'));
        transaction.onerror = () => reject(transaction.error || request.error);
    });
}

async function idbDelete(attemptId: string): Promise<void> {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
        const request = transaction.objectStore(SNAPSHOT_STORE).delete(attemptId);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Penghapusan IndexedDB dibatalkan'));
        transaction.onerror = () => reject(transaction.error || request.error);
    });
}

function readLegacy(attemptId: string): ExamAnswerSnapshot | null {
    try {
        const raw = localStorage.getItem(legacyKey(attemptId));
        return raw ? normalizeSnapshot(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

function writeLegacy(attemptId: string, snapshot: ExamAnswerSnapshot): boolean {
    try {
        localStorage.setItem(legacyKey(attemptId), JSON.stringify(snapshot));
        return true;
    } catch {
        return false;
    }
}

/** Reconcile each answer independently; an empty answer is also a versioned edit. */
export function mergeExamSnapshots(current: ExamAnswerSnapshot | null, incoming: ExamAnswerSnapshot): ExamAnswerSnapshot {
    // Once frozen, neither later edits nor stale retries may change the payload.
    if (current?.frozenSubmission) return current;
    if (!current || incoming.frozenSubmission) return incoming;
    const answers = { ...current.answers };
    const revisions = { ...current.revisions };
    const doubtful = new Set(current.doubtfulAnswers);
    const ids = new Set([...Object.keys(incoming.answers), ...Object.keys(incoming.revisions || {}), ...incoming.doubtfulAnswers]);
    for (const id of ids) {
        if ((incoming.revisions?.[id] ?? 0) < (current.revisions?.[id] ?? 0)) continue;
        if (Object.prototype.hasOwnProperty.call(incoming.answers, id)) answers[id] = incoming.answers[id];
        revisions[id] = incoming.revisions?.[id] ?? 0;
        if (incoming.doubtfulAnswers.includes(id)) doubtful.add(id); else doubtful.delete(id);
    }
    const assignment = incoming.assignmentData && (incoming.assignmentRevision ?? 0) >= (current.assignmentRevision ?? 0)
        ? incoming : current;
    return { answers, revisions, doubtfulAnswers: [...doubtful],
        ...(assignment.assignmentData ? { assignmentData: assignment.assignmentData, assignmentRevision: assignment.assignmentRevision } : {}),
    };
}

async function readCurrentSnapshot(attemptId: string): Promise<ExamAnswerSnapshot | null> {
    const durable = await idbGet(attemptId).catch(() => null);
    const legacy = readLegacy(attemptId);
    return legacy ? mergeExamSnapshots(durable, legacy) : durable;
}

/** Serialisasi penulisan mencegah write lambat menimpa snapshot yang lebih baru. */
export function createSerializedWriter<T, R>(
    write: (value: T) => Promise<R>,
): (value: T) => Promise<R> {
    let tail = Promise.resolve();
    return (value: T) => {
        const current = tail.catch(() => undefined).then(() => write(value));
        tail = current.then(() => undefined, () => undefined);
        return current;
    };
}

function enqueueSnapshotOperation<T>(attemptId: string, operation: () => Promise<T>): Promise<T> {
    const previous = snapshotTails.get(attemptId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async (): Promise<T> => {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return await navigator.locks.request(`exam-snapshot:${attemptId}`, operation);
        }
        return operation();
    });
    const settled = current.then(() => undefined, () => undefined);
    snapshotTails.set(attemptId, settled);
    void settled.finally(() => {
        if (snapshotTails.get(attemptId) === settled) snapshotTails.delete(attemptId);
    });
    return current;
}

async function writeSnapshotNow(
    attemptId: string,
    snapshot: ExamAnswerSnapshot,
): Promise<ExamStorageWriteResult> {
    // Never mirror after awaiting IndexedDB: a newer synchronous edit may already
    // be in localStorage by then.
    const mirrored = writeLegacy(attemptId, snapshot);
    try {
        await idbPut(attemptId, snapshot);
        return { saved: true, mode: 'indexeddb' };
    } catch {
        return mirrored
            ? { saved: true, mode: 'localstorage' }
            : { saved: false, mode: 'unavailable' };
    }
}

export async function writeExamSnapshot(
    attemptId: string,
    snapshot: ExamAnswerSnapshot,
): Promise<ExamStorageWriteResult> {
    // This runs before the first await, closing the reload gap while IDB is busy.
    const immediate = mergeExamSnapshots(readLegacy(attemptId), snapshot);
    writeLegacy(attemptId, immediate);
    return enqueueSnapshotOperation(attemptId, async () => {
        const current = await readCurrentSnapshot(attemptId);
        return writeSnapshotNow(attemptId, mergeExamSnapshots(current, immediate));
    });
}

export async function readExamSnapshot(attemptId: string): Promise<ExamAnswerSnapshot | null> {
    // Sinkronisasi yang dipicu event `online` dapat berimpit dengan klik jawaban
    // terakhir. Tunggu antrean tulis agar pembacaan tidak mengambil snapshot lama.
    const pendingWrite = snapshotTails.get(attemptId);
    if (pendingWrite) await pendingWrite;

    return readCurrentSnapshot(attemptId);
}

export async function removeExamSnapshot(attemptId: string): Promise<void> {
    await enqueueSnapshotOperation(attemptId, async () => {
        try { await idbDelete(attemptId); } catch { /* tetap bersihkan fallback */ }
        try { localStorage.removeItem(legacyKey(attemptId)); } catch { /* sudah final di server */ }
    });
}

/**
 * Simpan ID perangkat dalam database yang sama dengan jawaban. Transaksi
 * readwrite membuat dua tab pertama yang terbuka bersamaan tetap memilih ID
 * yang sama; transaksi kedua melihat nilai yang dibuat transaksi pertama.
 */
export async function resolveDurableDeviceId(candidate: string): Promise<string> {
    try {
        const db = await openDatabase();
        return await new Promise<string>((resolve, reject) => {
            const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
            const store = transaction.objectStore(SETTINGS_STORE);
            const request = store.get('device-id');
            let resolved = candidate;

            request.onsuccess = () => {
                const existing = request.result?.value;
                if (typeof existing === 'string' && existing) {
                    resolved = existing;
                } else {
                    store.put({ key: 'device-id', value: candidate });
                }
            };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(resolved);
            transaction.onabort = () => reject(transaction.error || new Error('ID perangkat gagal disimpan'));
            transaction.onerror = () => reject(transaction.error || request.error);
        });
    } catch {
        return candidate;
    }
}

/** Uji tulis nyata sebelum attempt dibuat, termasuk kapasitas dan persistence. */
export async function inspectExamStorage(): Promise<ExamStorageHealth> {
    const probeId = `__probe__${Date.now()}`;
    try {
        await idbPut(probeId, { answers: {}, doubtfulAnswers: [] });
        await idbDelete(probeId);

        let persistent = false;
        let freeBytes: number | null = null;
        if (typeof navigator !== 'undefined' && navigator.storage) {
            try {
                persistent = await navigator.storage.persisted();
                if (!persistent && navigator.storage.persist) {
                    persistent = await navigator.storage.persist();
                }
            } catch { /* browser tidak mendukung permintaan persistence */ }
            try {
                const estimate = await navigator.storage.estimate();
                if (typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
                    freeBytes = Math.max(0, estimate.quota - estimate.usage);
                }
            } catch { /* estimasi bersifat opsional */ }
        }

        const warning = freeBytes !== null && freeBytes < MIN_FREE_BYTES
            ? 'Ruang penyimpanan browser hampir penuh. Kosongkan ruang sebelum ujian.'
            : undefined;
        return { available: true, mode: 'indexeddb', persistent, warning };
    } catch {
        try {
            const key = `__exam_storage_probe_${Date.now()}`;
            localStorage.setItem(key, '1');
            localStorage.removeItem(key);
            return {
                available: true,
                mode: 'localstorage',
                persistent: false,
                warning: 'IndexedDB tidak tersedia. Jawaban memakai penyimpanan kompatibilitas; jangan tutup atau memuat ulang browser saat offline.',
            };
        } catch {
            return {
                available: false,
                mode: 'unavailable',
                persistent: false,
                warning: 'Browser tidak mengizinkan penyimpanan jawaban. Nonaktifkan mode privat atau gunakan browser lain.',
            };
        }
    }
}

export class ExamSnapshotConflictError extends Error {
    readonly code = 'EXAM_SNAPSHOT_CONFLICT';
    constructor() {
        super('Salinan jawaban berbeda dengan cadangan yang terkunci. Pengumpulan perlu diperiksa. Jangan tutup halaman; hubungi proktor.');
        this.name = 'ExamSnapshotConflictError';
    }
}

/** Empty UI defaults are equivalent to no assignment; retain every actual attachment/text. */
function assignmentContents(data: ExamAnswerSnapshot['assignmentData']) {
    return Object.fromEntries(Object.entries(data || {}).filter(([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)));
}

function sameSnapshotContents(left: ExamAnswerSnapshot, right: ExamAnswerSnapshot): boolean {
    const canonical = (value: unknown): string => {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.entries(value)
            .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
        return JSON.stringify(value) ?? 'null';
    };
    const contents = (snapshot: ExamAnswerSnapshot) => ({ answers: snapshot.answers, revisions: snapshot.revisions || {},
        doubtfulAnswers: [...snapshot.doubtfulAnswers].sort(), assignmentData: assignmentContents(snapshot.assignmentData) });
    return canonical(contents(left)) === canonical(contents(right)) && (!left.frozenSubmission ||
        canonical(left.frozenSubmission) === canonical(right.frozenSubmission));
}

async function rejectSnapshotConflict(attemptId: string, snapshot: ExamAnswerSnapshot): Promise<never> {
    // Keep the conflicting draft separately; it must never become an automatic delivery.
    const suffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    await writeSnapshotNow(`${attemptId}:conflict:${suffix}`, snapshot);
    throw new ExamSnapshotConflictError();
}

function canFreezeSnapshot(current: ExamAnswerSnapshot, requested: ExamAnswerSnapshot): boolean {
    if (sameSnapshotContents(current, requested)) return true;
    if (current.frozenSubmission) return false;
    for (const id of new Set([...Object.keys(current.answers), ...Object.keys(current.revisions || {})])) {
        const before = current.revisions?.[id] ?? 0;
        const after = requested.revisions?.[id] ?? 0;
        if (after < before || (after === before && (current.answers[id] !== requested.answers[id] ||
            current.doubtfulAnswers.includes(id) !== requested.doubtfulAnswers.includes(id)))) return false;
    }
    if (!Object.keys(assignmentContents(current.assignmentData)).length ||
        (requested.assignmentRevision ?? 0) > (current.assignmentRevision ?? 0)) return true;
    return sameSnapshotContents({ answers: {}, doubtfulAnswers: [], assignmentData: current.assignmentData },
        { answers: {}, doubtfulAnswers: [], assignmentData: requested.assignmentData });
}

/** Freeze only the requested payload. A different draft must never borrow an older delivery. */
export async function freezeExamSnapshot(attemptId: string, snapshot: ExamAnswerSnapshot): Promise<ExamAnswerSnapshot> {
    const legacy = readLegacy(attemptId);
    if (legacy && !canFreezeSnapshot(legacy, snapshot)) return rejectSnapshotConflict(attemptId, snapshot);
    // Journal the draft immediately, but publish the frozen flag only under the cross-tab lock.
    if (!legacy?.frozenSubmission) writeLegacy(attemptId, { ...snapshot, frozenSubmission: undefined });
    return enqueueSnapshotOperation(attemptId, async () => {
        const current = await readCurrentSnapshot(attemptId);
        if (current && !canFreezeSnapshot(current, snapshot)) return rejectSnapshotConflict(attemptId, snapshot);
        const frozen = current?.frozenSubmission ? current : snapshot;
        const result = await writeSnapshotNow(attemptId, frozen);
        if (!result.saved) throw new Error('Salinan jawaban terkunci belum tersimpan di perangkat. Jangan tutup halaman.');
        return frozen;
    });
}

export interface ExamSubmissionRegistration {
    attemptId: string;
    examId: string;
    userId: string;
    deviceId: string;
    startedAt: string;
    personalEndTime: string;
    deadlineAt: number;
    assignment: boolean;
    registeredAt?: number;
}
const SUBMISSION_PREFIX = 'exam_submission_';
export const EXAM_SUBMISSION_QUEUE_CHANGED = 'exam-submission-queue-changed';

function submissionRegistration(session: ExamRecoverySession): ExamSubmissionRegistration | null {
    const { started_at: startedAt, personal_end_time: personalEndTime } = session.attempt;
    if (!startedAt || !personalEndTime || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(personalEndTime))) return null;
    return { attemptId: session.attemptId, examId: session.examId, userId: session.userId,
        deviceId: session.deviceId, startedAt, personalEndTime, deadlineAt: session.deadlineAt,
        assignment: session.exam.exam_type === 'assignment', registeredAt: Date.parse(session.cachedAt) || 0 };
}
function validRegistration(value: unknown): value is ExamSubmissionRegistration {
    if (!value || typeof value !== 'object') return false;
    const row = value as ExamSubmissionRegistration;
    return ['attemptId', 'examId', 'userId', 'deviceId', 'startedAt', 'personalEndTime'].every(key =>
        typeof row[key as keyof ExamSubmissionRegistration] === 'string' && Boolean(row[key as keyof ExamSubmissionRegistration])) &&
        Number.isFinite(row.deadlineAt) && Number.isFinite(Date.parse(row.startedAt)) && Number.isFinite(Date.parse(row.personalEndTime));
}
async function writeSubmissionRegistration(entry: ExamSubmissionRegistration): Promise<void> {
    const key = SUBMISSION_PREFIX + entry.attemptId;
    let mirrored = false;
    try { localStorage.setItem(key, JSON.stringify(entry)); mirrored = true; } catch { /* IndexedDB may still work. */ }
    try {
        const db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(SETTINGS_STORE, 'readwrite');
            tx.objectStore(SETTINGS_STORE).put({ key, value: entry });
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Antrean pengiriman belum tersimpan.'));
        });
    } catch (error) { if (!mirrored) throw error; }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(EXAM_SUBMISSION_QUEUE_CHANGED));
    }
}
/** Minimal ownership index; it survives removal of the offline question cache at logout. */
export async function registerExamSubmission(session: ExamRecoverySession): Promise<void> {
    const entry = submissionRegistration(session);
    if (entry) await writeSubmissionRegistration(entry);
}
export async function listExamSubmissionRegistrations(): Promise<ExamSubmissionRegistration[]> {
    const entries = new Map<string, ExamSubmissionRegistration>();
    const keepNewest = (entry: ExamSubmissionRegistration) => {
        const previous = entries.get(entry.attemptId);
        if (!previous || Date.parse(entry.startedAt) > Date.parse(previous.startedAt) ||
            (Date.parse(entry.startedAt) === Date.parse(previous.startedAt) && (entry.registeredAt || 0) >= (previous.registeredAt || 0))) {
            entries.set(entry.attemptId, entry);
        }
    };
    // Older installations have recovery sessions but no minimal queue index yet.
    try {
        const sessions = await recoveryStoreRequest<unknown[]>('readonly', (store, resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        for (const value of sessions) {
            const session = normalizeRecoverySession(value);
            const entry = session && submissionRegistration(session);
            if (entry) keepNewest(entry);
        }
    } catch { /* Legacy browser fallback below. */ }
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith(SUBMISSION_PREFIX)) continue;
            try {
                const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
                if (validRegistration(value)) keepNewest(value);
            } catch { /* One damaged entry must not hide other attempts. */ }
        }
    } catch { /* IndexedDB can be used without localStorage. */ }
    try {
        const db = await openDatabase();
        const rows = await new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
            const request = db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        for (const row of rows) if (row.key.startsWith(SUBMISSION_PREFIX) && validRegistration(row.value)) {
            keepNewest(row.value);
        }
    } catch { /* Mirrored entries remain available. */ }
    return [...entries.values()];
}
/** Remove only the generation whose delivery was confirmed, preserving a later makeup/recovery. */
export async function removeExamSubmissionRegistration(attemptId: string, startedAt?: string, personalEndTime?: string): Promise<void> {
    const key = SUBMISSION_PREFIX + attemptId;
    const matches = (entry: unknown) => validRegistration(entry) && entry.startedAt === startedAt && entry.personalEndTime === personalEndTime;
    try {
        const db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(SETTINGS_STORE, 'readwrite');
            const store = tx.objectStore(SETTINGS_STORE);
            const request = store.get(key);
            request.onsuccess = () => { if (matches(request.result?.value)) store.delete(key); };
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error);
        });
    } catch { /* Clean the fallback independently. */ }
    try { if (matches(JSON.parse(localStorage.getItem(key) || 'null'))) localStorage.removeItem(key); } catch { /* optional mirror */ }
}
export async function removeConfirmedExamSnapshot(attemptId: string, context: NonNullable<ExamAnswerSnapshot['frozenSubmission']>): Promise<void> {
    await enqueueSnapshotOperation(attemptId, async () => {
        const current = await readCurrentSnapshot(attemptId);
        if (!current?.frozenSubmission || current.frozenSubmission.startedAt !== context.startedAt ||
            current.frozenSubmission.personalEndTime !== context.personalEndTime) return;
        try { await idbDelete(attemptId); } catch { /* Clean fallback independently. */ }
        try { localStorage.removeItem(legacyKey(attemptId)); } catch { /* optional mirror */ }
    });
}
