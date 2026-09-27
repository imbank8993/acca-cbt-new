-- Retry pembuatan setelah respons jaringan hilang tidak boleh menggandakan data.
-- Kolom nullable menjaga kompatibilitas data lama dan klien saat migrasi bergulir.

BEGIN;

ALTER TABLE public.cbt_exams
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_classes
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_additional_classes
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_pas_periods
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.exam_configs
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_question_banks
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_exams_client_request_unique
  ON public.cbt_exams (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_classes_client_request_unique
  ON public.cbt_classes (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_additional_classes_client_request_unique
  ON public.cbt_additional_classes (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_periods_client_request_unique
  ON public.cbt_pas_periods (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exam_configs_client_request_unique
  ON public.exam_configs (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_question_banks_client_request_unique
  ON public.cbt_question_banks (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
