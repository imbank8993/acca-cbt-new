export type BulkScheduleRowStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BulkScheduleRow {
    id: string;
    subject_id: string;
    class_id: string;
    bank_id: string;
    date: string;
    session_id: string;
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
    'subject_id' | 'class_id' | 'bank_id' | 'date' | 'session_id'
>> = ['subject_id', 'class_id', 'bank_id', 'date', 'session_id'];

export function isBlankScheduleRow(row: BulkScheduleRow): boolean {
    return REQUIRED_FIELDS.every((field) => !row[field]) && !row.room.trim();
}

export function isCompleteScheduleRow(row: BulkScheduleRow): boolean {
    return REQUIRED_FIELDS.every((field) => Boolean(row[field]));
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
            const result = await createSchedule({
                pas_period_id: periodId,
                bank_id: row.bank_id,
                subject_id: row.subject_id,
                class_id: row.class_id,
                scheduled_date: row.date,
                session_id: row.session_id,
                room: row.room.trim() || undefined,
            });
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
