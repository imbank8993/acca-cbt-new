import { BadRequestException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';

type QuestionDb = Pick<DbSession, 'from'>;

/**
 * Satu sumber kebenaran bank soal sebuah ujian.
 *
 * Data baru biasanya memakai `cbt_exams.question_bank_id`. Data legacy dan
 * konfigurasi multi-bank memakai `cbt_exam_question_sources`. Keduanya digabung
 * agar layar siswa, submit, review, monitoring, dan regrade melihat himpunan
 * bank yang persis sama. Bank langsung selalu lebih dulu; sumber tambahan
 * diurutkan berdasarkan UUID karena tabel legacy tidak mempunyai kolom urutan.
 */
export async function resolveExamBankIds(
    db: QuestionDb,
    examId: string,
    knownDirectBankId?: string | null,
): Promise<string[]> {
    let directBankId = knownDirectBankId;
    if (directBankId === undefined) {
        const { data: exam, error } = await db
            .from('cbt_exams')
            .select('question_bank_id')
            .eq('id', examId)
            .maybeSingle();
        if (error) throw new BadRequestException(error.message);
        directBankId = (exam as { question_bank_id: string | null } | null)?.question_bank_id ?? null;
    }

    const { data: sources, error } = await db
        .from('cbt_exam_question_sources')
        .select('bank_id')
        .eq('exam_id', examId);
    if (error) throw new BadRequestException(error.message);

    const sourceIds = ((sources as Array<{ bank_id: string | null }>) || [])
        .map(source => source.bank_id)
        .filter((bankId): bankId is string => Boolean(bankId))
        .sort((a, b) => a.localeCompare(b));

    return [...new Set([...(directBankId ? [directBankId] : []), ...sourceIds])];
}

/** Muat seluruh soal dari semua sumber dan beri urutan sumber yang stabil. */
export async function loadExamQuestions(
    db: QuestionDb,
    examId: string,
    select: string,
    knownDirectBankId?: string | null,
): Promise<any[]> {
    const bankIds = await resolveExamBankIds(db, examId, knownDirectBankId);
    if (bankIds.length === 0) return [];

    const normalizedSelect = select.trim();
    const selection = normalizedSelect === '*' || normalizedSelect.startsWith('*,') ||
        /(^|[\s,])bank_id([\s,]|$)/.test(normalizedSelect)
        ? normalizedSelect
        : `bank_id, ${normalizedSelect}`;

    const { data, error } = await db
        .from('cbt_bank_questions')
        .select(selection)
        .in('bank_id', bankIds)
        .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const sourceOrder = new Map(bankIds.map((bankId, index) => [bankId, index]));
    return ((data as any[]) || [])
        .map(question => {
            const copy = { ...question };
            // Dipakai internal untuk menjaga urutan lintas-bank, tetapi tidak
            // ikut terserialisasi ke browser, ekspor, atau layanan scoring.
            Object.defineProperty(copy, '__exam_source_order', {
                value: sourceOrder.get(question.bank_id) ?? bankIds.length,
                enumerable: false,
            });
            return copy;
        })
        .sort(compareExamQuestions);
}

function compareExamQuestions(a: any, b: any): number {
    if (a.__exam_source_order !== b.__exam_source_order) {
        return a.__exam_source_order - b.__exam_source_order;
    }

    const orderA = a.metadata?.order_index;
    const orderB = b.metadata?.order_index;
    if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
        return orderA - orderB;
    }
    if (Number.isFinite(orderA) !== Number.isFinite(orderB)) {
        return Number.isFinite(orderA) ? -1 : 1;
    }

    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id).localeCompare(String(b.id));
}
