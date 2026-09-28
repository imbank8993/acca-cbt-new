import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { NextRequest,NextResponse } from 'next/server';

/** Delete question data through the authorized backend; retain shared media. */
export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ bankId: string; questionId: string }> },
) {
    const { bankId, questionId } = await context.params;

    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const { status, body } = await nestFetchAsUser<{
        id?: string;
        softDeleted?: boolean;
        orphanedImages?: string[];
        message?: string;
        error?: string;
    }>(
        `/question-banks/${encodeURIComponent(bankId)}/questions/${encodeURIComponent(questionId)}`,
        token,
        { method: 'DELETE' },
    );

    if (status < 200 || status >= 300) {
        return NextResponse.json(
            { success: false, error: body?.error || 'Gagal menghapus soal.' },
            { status },
        );
    }

    // HTML is user-controlled, not proof of file ownership or exclusive use.
    // Keep attachments: another question, bank, or historical exam may use them.

    return NextResponse.json({
        success: true,
        id: body?.id,
        softDeleted: body?.softDeleted ?? false,
        message: body?.message,
        removedFiles: 0,
    });
}
