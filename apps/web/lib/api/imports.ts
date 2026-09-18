import { apiSend } from './client';

/**
 * Impor massal soal ke satu bank. Menggantikan `app/actions/bulk-import.ts`.
 *
 * `orgId` tidak lagi dikirim: NestJS menurunkan organisasinya dari bank soal
 * yang dituju. Versi lama memakai `orgId` kiriman browser, sehingga soal bisa
 * ditulis dengan organisasi yang bukan pemilik banknya.
 */

export interface BulkQuestionData {
    question_text: string;
    type: string;
    difficulty: 'easy' | 'medium' | 'hard';
    score_default: number;
    metadata?: Record<string, any>;
    options?: {
        option_text: string;
        is_correct: boolean;
        order: number;
        weight: number;
        metadata?: Record<string, any>;
    }[];
}

export interface BulkImportResult {
    success: boolean;
    imported: number;
    failed: number;
    errors: { index: number; message: string }[];
    questionIds?: string[];
}

export async function bulkImportQuestions(
    bankId: string,
    questions: BulkQuestionData[],
): Promise<BulkImportResult> {
    const res = await apiSend<BulkImportResult>(
        `/api/question-banks/${encodeURIComponent(bankId)}/bulk-import`,
        { questions },
    );

    // Kegagalan di tingkat permintaan (401, 403, jaringan putus) tidak punya
    // daftar `errors`, sedangkan layar impor menampilkan pesan pertamanya. Jadi
    // pesannya dibungkus ke bentuk yang sama supaya tidak muncul sebagai "Import
    // gagal tanpa pesan error."
    if (!res.success) {
        return {
            success: false,
            imported: 0,
            failed: questions.length,
            errors: [{ index: -1, message: res.error }],
        };
    }

    return res;
}
