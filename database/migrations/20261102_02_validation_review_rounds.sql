-- =============================================================================
-- Validasi bank soal: putaran telaah ulang, status per butir, verifikasi perbaikan.
-- =============================================================================
--
-- * Sesi validasi punya `round` (putaran) dan status baru `resubmitted`
--   ("Menunggu telaah ulang") setelah pembuat soal mengajukan perbaikan.
-- * Catatan menyimpan putaran & versi soal saat dibuat (`question_revision`),
--   hasil pemeriksaan validator atas perbaikan (`verification`), dan tanggapan
--   pembuat soal (`owner_response`).
-- * Status kelayakan per butir per validator disimpan di
--   `cbt_question_validation_items`, terpisah dari catatan.
-- =============================================================================

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cbt_question_bank_validations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%(status)%'
  LOOP
    EXECUTE format('ALTER TABLE public.cbt_question_bank_validations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cbt_question_bank_validations
  ADD CONSTRAINT cbt_question_bank_validations_status_check
  CHECK (status IN ('pending', 'in_progress', 'revision_needed', 'resubmitted', 'approved', 'rejected'));

ALTER TABLE public.cbt_question_bank_validations
  ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;

ALTER TABLE public.cbt_question_validation_notes
  ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS question_revision integer,
  ADD COLUMN IF NOT EXISTS verification varchar(16),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_response text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_question_validation_notes'::regclass
      AND conname = 'cbt_question_validation_notes_verification_check'
  ) THEN
    ALTER TABLE public.cbt_question_validation_notes
      ADD CONSTRAINT cbt_question_validation_notes_verification_check
      CHECK (verification IS NULL OR verification IN ('accepted', 'not_fixed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cbt_question_validation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id uuid NOT NULL REFERENCES public.cbt_question_bank_validations(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.cbt_bank_questions(id) ON DELETE CASCADE,
  validator_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL CHECK (status IN ('valid', 'revision', 'rejected')),
  round integer NOT NULL DEFAULT 1,
  question_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cbt_question_validation_items_unique UNIQUE (validation_id, question_id, validator_id)
);

CREATE INDEX IF NOT EXISTS cbt_question_validation_items_validator_idx
  ON public.cbt_question_validation_items (validation_id, validator_id);

ALTER TABLE public.cbt_question_validation_items ENABLE ROW LEVEL SECURITY;

COMMIT;
