import { BadRequestException } from '@nestjs/common';
import { applyExamQuestionKey, type KeyQuestion } from '@acca-cbt/shared';
import type { DbService, DbSession } from '../prisma/prisma-db-adapter';
import { loadExamQuestions } from './exam-question-sources';
import { advisoryTransactionLock } from './transaction-lock';

/** Seluruh data yang dapat memengaruhi tampilan, urutan, dan nilai. */
export const EXAM_QUESTION_SNAPSHOT_SELECT = `
  id, bank_id, question_text, type, score_default, metadata, dimension_id,
  difficulty, created_at, revision,
  bank_question_options:cbt_bank_question_options(
    id, option_text, is_correct, weight, order, metadata
  ),
  stimulus:cbt_question_stimuli(*),
  instruction:cbt_question_instructions(*)
`;

export type FrozenExamQuestion = Record<string, unknown> & {
  id: string;
  type: string;
  metadata?: unknown;
  __exam_source_order?: number;
  bank_question_options?: unknown[];
};

interface SnapshotRow {
  order_number: number;
  question_snapshot: FrozenExamQuestion;
}

/** Read the same question version inside an existing answer transaction. */
export async function readExamQuestionVersion(db: DbSession, examId: string): Promise<FrozenExamQuestion[]> {
  const snapshots = await readSnapshots(db, examId);
  if (snapshots.length) return applyCorrections(db, examId, snapshots.map(row => row.question_snapshot));
  return loadExamQuestions(db, examId, EXAM_QUESTION_SNAPSHOT_SELECT) as Promise<FrozenExamQuestion[]>;
}

async function applyCorrections(db: DbSession, examId: string, questions: FrozenExamQuestion[]): Promise<FrozenExamQuestion[]> {
  const { data, error } = await db.from('cbt_exams').select('metadata').eq('id', examId).maybeSingle();
  if (error) throw new BadRequestException('Revisi kunci ujian belum dapat dibaca.');
  const keys = data?.metadata?.answer_key_overrides || {};
  return questions.map(question => typeof keys[question.id] === 'string'
    ? applyExamQuestionKey(question as KeyQuestion, keys[question.id]) as FrozenExamQuestion : question);
}

async function readSnapshots(db: DbSession, examId: string): Promise<SnapshotRow[]> {
  const { data, error } = await db
    .from('cbt_exam_question_snapshots')
    .select('order_number, question_snapshot')
    .eq('exam_id', examId)
    .order('order_number', { ascending: true });
  if (error) throw new BadRequestException('Snapshot soal ujian belum dapat dibaca.');
  return (data as SnapshotRow[]) || [];
}

export async function hasExamQuestionSnapshots(db: DbSession, examId: string): Promise<boolean> {
  const rows = await readSnapshots(db, examId);
  return rows.length > 0;
}

/** Harus dipanggil di dalam transaksi yang memegang advisory lock ujian. */
export async function ensureExamQuestionSnapshotsInTransaction(
  db: DbSession,
  examId: string,
  knownDirectBankId?: string | null,
): Promise<FrozenExamQuestion[]> {
  await advisoryTransactionLock(db, `exam-question-snapshot:${examId}`);
  const existing = await readSnapshots(db, examId);
  if (existing.length > 0) return applyCorrections(db, examId, existing.map(row => row.question_snapshot));

  const candidates = await loadExamQuestions(
    db,
    examId,
    EXAM_QUESTION_SNAPSHOT_SELECT,
    knownDirectBankId,
  );
  if (candidates.length === 0) return [];
  // Serialize against bank edits before freezing option IDs. Re-read after
  // acquiring the locks so a just-committed edit cannot leave dangling options.
  const lockedIds = new Set(candidates.map(question => question.id));
  for (const id of [...lockedIds].sort()) {
    await db.raw('SELECT id FROM public.cbt_bank_questions WHERE id = $1::uuid FOR SHARE', id);
  }
  const questions = (await loadExamQuestions(db, examId, EXAM_QUESTION_SNAPSHOT_SELECT, knownDirectBankId))
    .filter(question => lockedIds.has(question.id));
  if (questions.length === 0) return [];

  // Salinan JSON memutus referensi objek adapter/fixture dan sekaligus menjamin
  // hanya data serializable yang masuk ke kolom jsonb.
  const snapshots = questions.map(
    question => JSON.parse(JSON.stringify(question)) as FrozenExamQuestion,
  );
  const { error } = await db.from('cbt_exam_question_snapshots').insert(
    snapshots.map((question, index) => ({
      exam_id: examId,
      question_id: question.id,
      order_number: index + 1,
      question_snapshot: question,
    })),
  );
  if (error) throw new BadRequestException('Snapshot soal ujian gagal dibuat.');
  return snapshots;
}

/** Ambil snapshot yang sudah ada, atau bekukan bank saat pertama kali dipakai. */
export async function loadFrozenExamQuestions(
  db: DbService,
  examId: string,
  knownDirectBankId?: string | null,
): Promise<FrozenExamQuestion[]> {
  const existing = await readSnapshots(db, examId);
  if (existing.length > 0) return applyCorrections(db, examId, existing.map(row => row.question_snapshot));

  // Attempt yang sudah ada sebelum fitur snapshot tidak memiliki versi historis
  // yang dapat direkonstruksi dengan jujur. Tetap izinkan tampilan/penilaian
  // operasional memakai bank saat ini, tetapi jangan menyimpannya seolah-olah
  // itulah kunci asli. Regrade/IRT memblokir kasus legacy ini secara terpisah.
  const { data: historicalAttempt, error } = await db
    .from('cbt_exam_attempts')
    .select('id')
    .eq('exam_id', examId)
    .limit(1)
    .maybeSingle();
  if (error) throw new BadRequestException('Riwayat ujian belum dapat diperiksa.');
  if (historicalAttempt) {
    return loadExamQuestions(
      db,
      examId,
      EXAM_QUESTION_SNAPSHOT_SELECT,
      knownDirectBankId,
    ) as Promise<FrozenExamQuestion[]>;
  }

  return db.transaction(transaction =>
    ensureExamQuestionSnapshotsInTransaction(transaction, examId, knownDirectBankId),
  );
}
