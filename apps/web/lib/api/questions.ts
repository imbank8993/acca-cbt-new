import { apiCreate,apiGet,apiIdempotentMutation,apiSend } from './client';

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
 * Lingkup sekolah untuk daftar dan pembuatan juga diambil dari sesi
 * terverifikasi, sehingga browser tidak lagi mengirim `organizationId`.
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

export interface KisiKisiItem {
    id: string;
    materi?: string | null;
    indikator_soal?: string | null;
    level_kognitif?: string | null;
}

export interface BankTextItem {
    id: string;
    title?: string | null;
    content: string;
}

export interface DimensionItem {
    id: string;
    name: string;
    description?: string | null;
}

export interface DimensionInterpretationItem {
    id: string;
    dimension_id: string;
    min_score: number;
    max_score: number;
    title?: string | null;
    interpretation?: string | null;
}

export interface QuestionBank {
    id: string;
    title: string;
    name?: string;
    description?: string | null;
    subject?: string | null;
    class_level?: string | null;
    classLevel?: string | null;
    icon_identifier?: string | null;
    image_url?: string | null;
    tags?: string[];
    folder_id?: string | null;
    is_published?: boolean;
    created_at?: string;
    updated_at?: string;
    question_count?: number;
    total_questions?: number;
    creator_name?: string | null;
}

export interface BankFolder {
    id: string;
    name: string;
    order?: number;
}

export interface OrganizationLabel {
    id: string;
    name: string;
    color: string;
}

export interface QuestionOptionMetadata {
    match_text?: string;
    match_texts?: string[];
    category_name?: string;
    category_names?: string[];
    dimension_id?: string | null;
    image_url?: string;
    [key: string]: unknown;
}

export interface QuestionOptionRecord {
    id?: string;
    option_text?: string;
    text?: string;
    is_correct?: boolean;
    isCorrect?: boolean;
    order?: number;
    weight?: number;
    match_texts?: string[];
    category_names?: string[];
    dimension_id?: string | null;
    metadata?: QuestionOptionMetadata;
}

export interface QuestionOptionDraft extends QuestionOptionRecord {
    text: string;
    isCorrect: boolean;
    order: number;
    weight: number;
    match_texts: string[];
    category_names: string[];
}

export interface QuestionMetadata {
    categories?: string[];
    kisi_kisi?: string;
    pembahasan?: string;
    correct_order?: string[];
    blanks?: { answer: string; variations: string[] }[];
    import_stimulus?: string;
    import_instruction?: string;
    import_source_number?: number;
    isComplex?: boolean;
    is_multi_topic?: boolean;
    right_items?: string[];
    _stimulus_code?: string;
    _instruction_code?: string;
    [key: string]: unknown;
}

export interface QuestionRecord {
    id: string;
    number?: number;
    type: QuestionType;
    question_text: string;
    score_default: number;
    bank_question_options?: QuestionOptionRecord[];
    options?: QuestionOptionRecord[];
    metadata?: QuestionMetadata;
    stimulus_id?: string | null;
    instruction_id?: string | null;
    dimension_id?: string | null;
    kisi_kisi_id?: string | null;
    stimulus?: BankTextItem | null;
    instruction?: BankTextItem | null;
    question_dimensions?: DimensionItem | null;
    created_at?: string;
    updated_at?: string;
    revision?: number;
}

// ── Bank soal ────────────────────────────────────────────────────────────────

export async function listQuestionBanks(onlyPublished?: boolean): Promise<QuestionBank[]> {
    const query = new URLSearchParams();
    if (onlyPublished) query.set('onlyPublished', 'true');

    const res = await apiGet<{ banks: QuestionBank[] }>(`/api/question-banks?${query.toString()}`);
    return res.success ? res.banks : [];
}

export async function getQuestionBankAction(bankId: string): Promise<QuestionBank | null> {
    const res = await apiGet<{ bank: QuestionBank }>(`/api/question-banks/${encodeURIComponent(bankId)}`);
    return res.success ? res.bank : null;
}

export function createQuestionBank(
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
    return apiCreate<{ id: string }>('/api/question-banks', input);
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

export async function listBankFolders(): Promise<BankFolder[]> {
    const res = await apiGet<{ folders: BankFolder[] }>('/api/question-banks/folders');
    return res.success ? res.folders : [];
}

export function createBankFolder(name: string) {
    return apiCreate<{ id: string }>('/api/question-banks/folders', { name });
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

export async function listOrganizationLabels(): Promise<OrganizationLabel[]> {
    const res = await apiGet<{ labels: OrganizationLabel[] }>('/api/question-banks/labels');
    return res.success ? res.labels : [];
}

export function createOrganizationLabel(name: string, color: string) {
    return apiCreate<{ id: string }>('/api/question-banks/labels', { name, color });
}

// ── Soal ─────────────────────────────────────────────────────────────────────

export async function getBankQuestions(bankId: string): Promise<QuestionRecord[]> {
    const res = await apiGet<{ questions: QuestionRecord[] }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/questions`,
    );
    return res.success ? res.questions : [];
}

export async function saveQuestionAction(data: {
    id?: string;
    expectedRevision?: number;
    bankId: string;
    type: QuestionType;
    questionText: string;
    difficulty: 'easy' | 'medium' | 'hard';
    scoreDefault: number;
    metadata?: QuestionMetadata;
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
        metadata?: QuestionOptionMetadata;
    }[];
}) {
    const res = data.id
        ? await apiSend<{ id: string; activeExams: { id: string; title: string }[] }>(
            '/api/question-banks/questions', data, 'PUT',
        )
        : await apiIdempotentMutation<{
            id: string; activeExams: { id: string; title: string }[]
        }>('/api/question-banks/questions', data, 'PUT');

    return res.success
        ? { success: true as const, id: res.id, activeExams: res.activeExams }
        : { success: false as const, activeExams: [], error: res.error };
}

export function updateQuestionMetadataAction(
    questionId: string,
    metadataUpdates: Record<string, unknown>,
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
        create: <P extends object>(bankId: string, payload: P) =>
            apiCreate<{ id: string }>(
                `/api/question-banks/${encodeURIComponent(bankId)}/${segment}`,
                payload,
            ),
        update: <P extends object>(id: string, payload: P) =>
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

const kisiKisi = bankChild<KisiKisiItem>('kisi-kisi');
const stimuli = bankChild<BankTextItem>('stimuli');
const instructions = bankChild<BankTextItem>('instructions');
const dimensions = bankChild<DimensionItem>('dimensions');
const interpretations = bankChild<DimensionInterpretationItem>('interpretations');

export const getKisiKisiByBank = kisiKisi.list;
export const deleteKisiKisi = kisiKisi.remove;

export function createKisiKisi(
    bankId: string,
    data: {
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
    return apiCreate<{ id: string }>('/api/question-banks/interpretations', {
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
    const res = await apiCreate<{ imported: number; errors: string[] }>(
        `/api/question-banks/${encodeURIComponent(bankId)}/${segment}/import`,
        { rows },
        { timeoutMs: 60_000 },
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
