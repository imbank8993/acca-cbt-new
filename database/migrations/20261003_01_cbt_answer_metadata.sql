-- Store answer revision and save-time metadata used by optimistic answer sync.

BEGIN;

ALTER TABLE public.cbt_answers
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
