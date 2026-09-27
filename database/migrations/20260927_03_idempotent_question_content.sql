-- Retry aman untuk soal baru dan seluruh isi pendamping bank soal.

BEGIN;

ALTER TABLE public.cbt_bank_questions
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_question_kisi_kisi
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_question_stimuli
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_question_instructions
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_question_dimensions
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_dimension_interpretations
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_bank_questions_client_request_unique
  ON public.cbt_bank_questions (bank_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_question_kisi_kisi_client_request_unique
  ON public.cbt_question_kisi_kisi (bank_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_question_stimuli_client_request_unique
  ON public.cbt_question_stimuli (bank_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_question_instructions_client_request_unique
  ON public.cbt_question_instructions (bank_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_question_dimensions_client_request_unique
  ON public.cbt_question_dimensions (bank_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_dimension_interpretations_client_request_unique
  ON public.cbt_dimension_interpretations (dimension_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
