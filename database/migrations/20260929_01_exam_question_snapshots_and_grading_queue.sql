-- SCORE-SNAPSHOT-01 / SCORE-RETRY-01
-- Bekukan paket soal per ujian dan percepat pemulihan auto-submit tanpa nilai.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_exam_question_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.cbt_bank_questions(id) ON DELETE SET NULL,
  order_number integer NOT NULL,
  question_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cbt_exam_question_snapshots_payload_object
    CHECK (jsonb_typeof(question_snapshot) = 'object'),
  CONSTRAINT cbt_exam_question_snapshots_order_positive
    CHECK (order_number >= 1),
  CONSTRAINT cbt_exam_question_snapshots_exam_question_unique
    UNIQUE (exam_id, question_id),
  CONSTRAINT cbt_exam_question_snapshots_exam_order_unique
    UNIQUE (exam_id, order_number)
);

CREATE INDEX IF NOT EXISTS cbt_exam_question_snapshots_exam_order
  ON public.cbt_exam_question_snapshots (exam_id, order_number);

CREATE INDEX IF NOT EXISTS cbt_exam_attempts_pending_auto_grading
  ON public.cbt_exam_attempts (exam_id, finished_at, id)
  WHERE status = 'auto_submitted' AND total_score IS NULL;

COMMIT;
