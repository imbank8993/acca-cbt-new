-- Optimistic concurrency untuk mencegah edit dua tab saling menimpa diam-diam.

BEGIN;

ALTER TABLE public.cbt_bank_questions
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

ALTER TABLE public.cbt_bank_questions
  DROP CONSTRAINT IF EXISTS cbt_bank_questions_revision_positive;
ALTER TABLE public.cbt_bank_questions
  ADD CONSTRAINT cbt_bank_questions_revision_positive CHECK (revision >= 1);

COMMIT;
