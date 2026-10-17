export type BulkScheduleRowStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BulkScheduleRow {
    id: string;
    subject_id: string;
    class_id: string;
    bank_id: string;
    date: string;
    session_id: string;
    duration_minutes?: number;
    room: string;
    status: BulkScheduleRowStatus;
    error?: string;
}

export interface BulkScheduleActionInput {
    pas_period_id: string;
    bank_id: string;
    subject_id?: string;
    class_id: string;
    scheduled_date: string;
    session_id: string;
    duration_override?: number;
    room?: string;
}

interface ActionResult {
    success: boolean;
    error?: string;
}

export interface BulkScheduleOutcome {
    rowId: string;
    success: boolean;
    error?: string;
}

export interface BulkScheduleSaveResult {
    outcomes: BulkScheduleOutcome[];
    incompleteIds: string[];
    duplicateIds: string[];
    blankIds: string[];
}

const REQUIRED_FIELDS: Array<keyof Pick<
    BulkScheduleRow,
    'class_id' | 'bank_id' | 'date' | 'session_id'
>> = ['class_id', 'bank_id', 'date', 'session_id'];

export function isBlankScheduleRow(row: BulkScheduleRow): boolean {
    return REQUIRED_FIELDS.every((field) => !row[field]) && !row.subject_id && !row.room.trim();
}

export function isCompleteScheduleRow(row: BulkScheduleRow): boolean {
    return REQUIRED_FIELDS.every((field) => Boolean(row[field]));
}

export function resolveBankSubjectId(
    bankId: string,
    qBanks: Array<{ id: string; subject?: string | null }>,
    subjects: Array<{ id: string; name: string }>,
    currentSubjectId = '',
): string {
    const selectedBank = qBanks.find((bank) => bank.id === bankId);
    const bankSubject = selectedBank?.subject?.trim().toLowerCase();
    if (!bankSubject) return currentSubjectId;
    const foundSubject = subjects.find((subject) => subject.name.trim().toLowerCase() === bankSubject);
    return foundSubject ? foundSubject.id : currentSubjectId;
}

function normalizeDateCell(raw: unknown, fallbackDate = ''): string {
    if (raw == null || raw === '') return fallbackDate;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000) {
        const utcMs = Math.round((raw - 25569) * 86400 * 1000);
        const dt = new Date(utcMs);
        if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    }
    const text = String(raw).trim();
    if (!text) return fallbackDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
        return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    return text;
}

function pickField(record: Record<string, unknown>, keys: string[]): unknown {
    const entries = Object.entries(record);
    for (const key of keys) {
        const target = key.toLowerCase();
        const found = entries.find(([k]) => k.trim().toLowerCase() === target || k.trim().toLowerCase().startsWith(target));
        if (found && found[1] != null && String(found[1]).trim() !== '') {
            return found[1];
        }
    }
    return '';
}

export function parseImportedScheduleRows(
    rawRows: Array<Record<string, unknown>>,
    catalog: {
        classes: Array<{ id: string; name: string }>;
        subjects: Array<{ id: string; name: string }>;
        qBanks: Array<{ id: string; title: string; subject?: string | null }>;
        sessions: Array<{ id: string; name: string }>;
        defaultDate?: string;
    },
    nextId: () => string,
): BulkScheduleRow[] {
    const normalizeClass = (value: string) => value.trim().toLowerCase().replace(/^kelas\s+/i, '');
    const parsed: BulkScheduleRow[] = [];

    for (const raw of rawRows) {
        const bankRaw = String(pickField(raw, ['bank soal', 'judul bank soal', 'bank_id', 'bank']) || '').trim();
        const subjectRaw = String(pickField(raw, ['mata pelajaran', 'mapel', 'subject_id', 'subject']) || '').trim();
        const classRaw = String(pickField(raw, ['kelas', 'nama kelas', 'class_id', 'class']) || '').trim();
        const dateRaw = pickField(raw, ['tanggal', 'tanggal ujian', 'scheduled_date', 'date']);
        const sessionRaw = String(pickField(raw, ['sesi ujian', 'sesi', 'session_id', 'session']) || '').trim();
        const durationRaw = pickField(raw, ['durasi (menit)', 'durasi', 'duration_minutes', 'duration']);
        const roomRaw = String(pickField(raw, ['ruangan', 'ruang', 'nama ruang', 'room']) || '').trim();

        if (!bankRaw && !subjectRaw && !classRaw && !dateRaw && !sessionRaw && !roomRaw) {
            continue;
        }

        const matchedBank = catalog.qBanks.find(
            (b) => b.id === bankRaw || b.title.trim().toLowerCase() === bankRaw.toLowerCase(),
        );
        const matchedSubject = subjectRaw
            ? catalog.subjects.find(
                (s) => s.id === subjectRaw || s.name.trim().toLowerCase() === subjectRaw.toLowerCase(),
            )
            : undefined;
        const resolvedSubjectId = matchedSubject?.id
            || (matchedBank ? resolveBankSubjectId(matchedBank.id, catalog.qBanks, catalog.subjects) : '');

        const matchedSession = catalog.sessions.find((s) => {
            const target = sessionRaw.toLowerCase();
            const cleanTarget = target.split('(')[0].trim();
            return s.id === sessionRaw
                || s.name.trim().toLowerCase() === target
                || s.name.trim().toLowerCase() === cleanTarget;
        });

        const dateValue = normalizeDateCell(dateRaw, catalog.defaultDate || '');
        const parsedDuration = Number.parseInt(String(durationRaw || '90'), 10);
        const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 90;

        const classTokens = classRaw
            ? classRaw.split(/[,;]+/).map((token) => token.trim()).filter(Boolean)
            : [''];

        for (const classToken of classTokens) {
            const matchedClass = classToken
                ? catalog.classes.find(
                    (c) => c.id === classToken
                        || c.name.trim().toLowerCase() === classToken.toLowerCase()
                        || normalizeClass(c.name) === normalizeClass(classToken),
                )
                : undefined;

            const missingNotes: string[] = [];
            if (bankRaw && !matchedBank) missingNotes.push(`Bank soal "${bankRaw}" tidak ditemukan`);
            if (classToken && !matchedClass) missingNotes.push(`Kelas "${classToken}" tidak ditemukan`);
            if (sessionRaw && !matchedSession) missingNotes.push(`Sesi "${sessionRaw}" tidak ditemukan`);

            parsed.push({
                id: nextId(),
                bank_id: matchedBank?.id || '',
                subject_id: resolvedSubjectId,
                class_id: matchedClass?.id || '',
                date: dateValue,
                session_id: matchedSession?.id || '',
                duration_minutes: durationMinutes,
                room: roomRaw,
                status: missingNotes.length > 0 ? 'error' : 'idle',
                error: missingNotes.length > 0 ? `${missingNotes.join('; ')}.` : undefined,
            });
        }
    }

    return parsed;
}

/** Menyimpan hanya baris yang belum berhasil dan memeriksa hasil HTTP per baris. */
export async function saveBulkScheduleRows(
    periodId: string,
    rows: BulkScheduleRow[],
    createSchedule: (input: BulkScheduleActionInput) => Promise<ActionResult>,
): Promise<BulkScheduleSaveResult> {
    const blankIds: string[] = [];
    const incompleteIds: string[] = [];
    const duplicateIds: string[] = [];
    const ready: BulkScheduleRow[] = [];
    const businessKeys = new Set<string>();

    for (const row of rows) {
        if (row.status === 'saved') {
            if (isCompleteScheduleRow(row)) {
                businessKeys.add(`${row.bank_id}\u0000${row.class_id}`);
            }
            continue;
        }
        if (isBlankScheduleRow(row)) {
            blankIds.push(row.id);
            continue;
        }
        if (!isCompleteScheduleRow(row)) {
            incompleteIds.push(row.id);
            continue;
        }

        const businessKey = `${row.bank_id}\u0000${row.class_id}`;
        if (businessKeys.has(businessKey)) {
            duplicateIds.push(row.id);
            continue;
        }
        businessKeys.add(businessKey);
        ready.push(row);
    }

    const outcomes = await Promise.all(ready.map(async (row): Promise<BulkScheduleOutcome> => {
        try {
            const payload: BulkScheduleActionInput = {
                pas_period_id: periodId,
                bank_id: row.bank_id,
                subject_id: row.subject_id || undefined,
                class_id: row.class_id,
                scheduled_date: row.date,
                session_id: row.session_id,
                room: row.room.trim() || undefined,
            };
            if (typeof row.duration_minutes === 'number' && row.duration_minutes > 0) {
                payload.duration_override = row.duration_minutes;
            }
            const result = await createSchedule(payload);
            return result.success
                ? { rowId: row.id, success: true }
                : { rowId: row.id, success: false, error: result.error || 'Jadwal gagal disimpan.' };
        } catch (error) {
            return {
                rowId: row.id,
                success: false,
                error: (error as Error).message || 'Tidak dapat menghubungi server.',
            };
        }
    }));

    return { outcomes, incompleteIds, duplicateIds, blankIds };
}
