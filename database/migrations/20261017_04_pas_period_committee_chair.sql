BEGIN;

ALTER TABLE public.cbt_pas_periods
ADD COLUMN IF NOT EXISTS committee_chair_name text,
ADD COLUMN IF NOT EXISTS committee_chair_nip text;

COMMIT;
