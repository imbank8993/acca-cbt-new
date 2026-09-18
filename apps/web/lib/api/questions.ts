import { apiGet, apiSend } from './client';

/**
 * Bank soal beserta isinya. Menggantikan `app/actions/question.ts`.
 *
 * Dua parameter hilang dari hampir seluruh tanda tangan di sini:
 *
 *  - `userId`, yang dulu dikirim browser dan dipakai sebagai CADANGAN otorisasi
 *    ketika sesi tidak terbaca — artinya otorisasinya bisa dilewati justru
 *    dengan tidak punya sesi sama sekali.
 *  - `orgId` pada operasi yang menyebut banknya: organisasinya diturunkan dari
 *    baris bank itu sendiri, sehingga id bank milik sekolah lain tidak bisa
 *    diselundupkan bersama organisasi milik sendiri.
 *
 * `orgId` tetap ada di tempat yang memang membutuhkannya sebagai lingkup —
 * daftar, pembuatan bank/folder/label — karena di sana belum ada baris yang bisa
 * menjadi acuan.
 */

export type QuestionType =
    | 'mcq'
    | 'mcq_complex'
    | 'true_false'
    | 'matching'
    | 'categorization'
    | 'short_answer'
    | 'essay'
    | 'sjt'
    | 'ordering'
    | 'likert'
    | 'forced_choice'
    | 'checklist'
    | 'ranking'
    | 'paired_comparison';

export interface ImportRow {
    Judul?: string;
    Konten?: string;
    Konten_HTML?: string;
}

// ── Bank soal ────────────────────────────────────────────────────────────────

export async function listQuestionBanks(orgId: string, onlyPublished?: boolean): Promise<any[]> {
    const query = new URLSearchParams({ organizationId: orgId });
    if (onlyPublished) query.set('onlyPublished', 'true');

    const res = await apiGet<{ banks: any[] }>(`/api/question-banks?${query.toString()}`);
    return res.success ? res.banks : [];
}

export async function getQuestionBankAction(bankId: string): Promise<any | null> {
    const res = await apiGet<{ bank: any }>(`/api/question-banks/${encodeURIComponent(bankId)}`);
    return res.success ? res.bank : null;
}

export function createQuestionBank(
    orgId: string,
    input: {
        title: string;
        description?: string;
        subject?: string;
        classLevel?: string;
        iconIdentifier?: string;
        imageUrl?: string;
        tags?: string[];
        folderId?: string | null;
    },
) {
    return apiSend<{ id: string }>('/api/question-banks', { organizationId: orgId, ...input });
}

export function updateQuestionBankAction(
    bankId: string,
    data: {
        title?: string;
        description?: string;
        subject?: string;
        classLevel?: string;
        iconIdentifier?: string;
        imageUrl?: string;
        tags?: string[];
        folderId?: string | null;
    },
) {
    return apiSend<{ id: string }>(
        `/api/question-banks/${encodeURIComponent(bankId)}`,
        data,
        'PATCH',
    );
}

export function deleteQuestionBank(bankId: string) {
    return apiSend<{ id: string }>(
        `/api/question-banks/${encodeURIComponent(bankId)}`,
        undefined,
        'DELETE',
    );
}

/**
 * Terbitkan atau tarik bank soal.
 *
 * `activeExams` selalu berupa array — layar menampilkan peringatan bila ada
 * ujian yang sedang berjalan memakai bank ini.
 */
export async function toggleQuestionBankPublishAction(bankId: string, isPublished: boolean) {
    const res = await apiSend<{ id: string; activeExams: { id: string; title: string }[] }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/publish`,
        { isPublished },
    );

    return res.success
        ? { success: true as const, activeExams: res.activeExams }
        : { success: false as const, activeExams: [], error: res.error };
}

// ── Folder ───────────────────────────────────────────────────────────────────

export async function listBankFolders(orgId: string): Promise<any[]> {
    const res = await apiGet<{ folders: any[] }>(
        `/api/question-banks/folders?organizationId=${encodeURIComponent(orgId)}`,
    );
    return res.success ? res.folders : [];
}

export function createBankFolder(orgId: string, name: string) {
    return apiSend<{ id: string }>('/api/question-banks/folders', {
        organizationId: orgId,
        name,
    });
}

export function updateBankFolder(folderId: string, name: string) {
    return apiSend<{ id: string }>(
        `/api/question-banks/folders/${encodeURIComponent(folderId)}`,
        { name },
        'PATCH',
    );
}

export function deleteBankFolder(folderId: string) {
    return apiSend<{ id: string }>(
        `/api/question-banks/folders/${encodeURIComponent(folderId)}`,
        undefined,
        'DELETE',
    );
}

export function moveBankToFolder(bankId: string, folderId: string | null) {
    return bulkMoveBanksToFolder([bankId], folderId);
}

export function bulkMoveBanksToFolder(bankIds: string[], folderId: string | null) {
    return apiSend<{ moved: number }>(
        '/api/question-banks/folders/move',
        { bankIds, folderId },
        'PUT',
    );
}

// ── Label ────────────────────────────────────────────────────────────────────

export async function listOrganizationLabels(orgId: string): Promise<any[]> {
    const res = await apiGet<{ labels: any[] }>(
        `/api/question-banks/labels?organizationId=${encodeURIComponent(orgId)}`,
    );
    return res.success ? res.labels : [];
}

export function createOrganizationLabel(orgId: string, name: string, color: string) {
    return apiSend<{ id: string }>('/api/question-banks/labels', {
        organizationId: orgId,
        name,
        color,
    });
}

// ── Soal ─────────────────────────────────────────────────────────────────────

export async function getBankQuestions(bankId: string): Promise<any[]> {
    const res = await apiGet<{ questions: any[] }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/questions`,
    );
    return res.success ? res.questions : [];
}

export async function saveQuestionAction(data: {
    id?: string;
    bankId: string;
    type: QuestionType;
    questionText: string;
    difficulty: 'easy' | 'medium' | 'hard';
    scoreDefault: number;
    metadata?: any;
    stimulusId?: string | null;
    instructionId?: string | null;
    dimensionId?: string | null;
    kisi_kisi_id?: string | null;
    options?: {
        id?: string;
        text: string;
        isCorrect: boolean;
        order: number;
        weight: number;
        metadata?: any;
    }[];
}) {
    const res = await apiSend<{ id: string; activeExams: { id: string; title: string }[] }>(
        '/api/question-banks/questions',
        data,
        'PUT',
    );

    return res.success
        ? { success: true as const, id: res.id, activeExams: res.activeExams }
        : { success: false as const, activeExams: [], error: res.error };
}

export function updateQuestionMetadataAction(
    questionId: string,
    metadataUpdates: Record<string, any>,
) {
    return apiSend<{ id: string }>(
        `/api/question-banks/questions/${encodeURIComponent(questionId)}/metadata`,
        { metadata: metadataUpdates },
        'PATCH',
    );
}

/**
 * Hapus satu soal.
 *
 * Soal yang sudah pernah dijawab peserta TIDAK dihapus melainkan disembunyikan,
 * dan itu dilaporkan sebagai keberhasilan dengan `softDeleted: true` — versi
 * lama mengembalikannya sebagai KEGAGALAN meski perubahannya benar-benar
 * tersimpan, sehingga guru melihat pesan galat untuk operasi yang berhasil.
 */
export async function deleteQuestionAction(questionId: string, bankId: string) {
    const res = await apiSend<{ id: string; softDeleted: boolean; message?: string }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/questions/${encodeURIComponent(questionId)}`,
        undefined,
        'DELETE',
    );

    return res.success
        ? { success: true as const, softDeleted: res.softDeleted, message: res.message }
        : { success: false as const, softDeleted: false, error: res.error };
}

export function updateQuestionsOrderAction(bankId: string, orderedIds: string[]) {
    return apiSend<{ updated: number }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/questions/order`,
        { orderedIds },
        'PUT',
    );
}

// ── Isi pendamping bank ──────────────────────────────────────────────────────
// Kisi-kisi, stimulus, petunjuk, dan dimensi memakai bentuk endpoint yang sama,
// jadi pembungkusnya dibangun dari satu pembantu.

function bankChild<T>(segment: string) {
    return {
        list: async (bankId: string): Promise<T[]> => {
            const res = await apiGet<{ items: T[] }>(
                `/api/question-banks/${encodeURIComponent(bankId)}/${segment}`,
            );
            return res.success ? res.items : [];
        },
        create: (bankId: string, payload: Record<string, unknown>) =>
            apiSend<{ id: string }>(
                `/api/question-banks/${encodeURIComponent(bankId)}/${segment}`,
                payload,
            ),
        update: (id: string, payload: Record<string, unknown>) =>
            apiSend<{ id: string }>(
                `/api/question-banks/${segment}/${encodeURIComponent(id)}`,
                payload,
                'PATCH',
            ),
        remove: (id: string) =>
            apiSend<{ id: string }>(
                `/api/question-banks/${segment}/${encodeURIComponent(id)}`,
                undefined,
                'DELETE',
            ),
    };
}

const kisiKisi = bankChild<any>('kisi-kisi');
const stimuli = bankChild<any>('stimuli');
const instructions = bankChild<any>('instructions');
const dimensions = bankChild<any>('dimensions');
const interpretations = bankChild<any>('interpretations');

export const getKisiKisiByBank = kisiKisi.list;
export const deleteKisiKisi = kisiKisi.remove;

export function createKisiKisi(
    bankId: string,
    data: {
        nomor_kd: string;
        kd_cp?: string;
        materi?: string;
        indikator_soal?: string;
        level_kognitif?: string;
    },
) {
    return kisiKisi.create(bankId, data);
}

export function updateKisiKisi(
    kisiKisiId: string,
    data: {
        nomor_kd?: string;
        kd_cp?: string;
        materi?: string;
        indikator_soal?: string;
        level_kognitif?: string;
    },
) {
    return kisiKisi.update(kisiKisiId, data);
}

export const getStimuliByBank = stimuli.list;
export const deleteStimulus = stimuli.remove;

export function createStimulus(bankId: string, title: string, content: string) {
    return stimuli.create(bankId, { title, content });
}

export function updateStimulus(stimulusId: string, title: string, content: string) {
    return stimuli.update(stimulusId, { title, content });
}

export const getInstructionsByBank = instructions.list;
export const deleteInstruction = instructions.remove;

export function createInstruction(bankId: string, title: string, content: string) {
    return instructions.create(bankId, { title, content });
}

export function updateInstruction(instructionId: string, title: string, content: string) {
    return instructions.update(instructionId, { title, content });
}

export const getDimensionsByBank = dimensions.list;
export const deleteDimension = dimensions.remove;

export function createDimension(bankId: string, name: string, description: string) {
    return dimensions.create(bankId, { name, description });
}

export function updateDimension(dimensionId: string, name: string, description: string) {
    return dimensions.update(dimensionId, { name, description });
}

export const getDimensionInterpretationsByBank = interpretations.list;
export const deleteDimensionInterpretation = interpretations.remove;

export function createDimensionInterpretation(
    dimensionId: string,
    minScore: number,
    maxScore: number,
    title: string,
    interpretation: string,
) {
    return apiSend<{ id: string }>('/api/question-banks/interpretations', {
        dimensionId,
        minScore,
        maxScore,
        title,
        interpretation,
    });
}

export function updateDimensionInterpretation(
    id: string,
    minScore: number,
    maxScore: number,
    title: string,
    interpretation: string,
) {
    return interpretations.update(id, { minScore, maxScore, title, interpretation });
}

// ── Impor XLS ────────────────────────────────────────────────────────────────
// Berkasnya dibaca di browser; yang dikirim hanya barisnya.

async function importRows(bankId: string, segment: 'stimuli' | 'instructions', rows: ImportRow[]) {
    const res = await apiSend<{ imported: number; errors: string[] }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/${segment}/import`,
        { rows },
    );

    return res.success
        ? { success: true as const, imported: res.imported, errors: res.errors }
        : { success: false as const, imported: 0, errors: [res.error] };
}

export function importStimuliFromXlsAction(bankId: string, rows: ImportRow[]) {
    return importRows(bankId, 'stimuli', rows);
}

export function importInstructionsFromXlsAction(bankId: string, rows: ImportRow[]) {
    return importRows(bankId, 'instructions', rows);
}
