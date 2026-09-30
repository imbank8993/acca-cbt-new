-- Nomor KD/CP and KD/CP descriptions are no longer stored for question outlines.
BEGIN;

ALTER TABLE IF EXISTS public.cbt_question_kisi_kisi
  DROP COLUMN IF EXISTS nomor_kd,
  DROP COLUMN IF EXISTS kd_cp;

COMMIT;
