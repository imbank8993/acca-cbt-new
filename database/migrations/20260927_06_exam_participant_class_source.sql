-- Simpan kelas asal peserta terpilih agar modal penugasan dapat dipulihkan tepat.
BEGIN;

ALTER TABLE public.cbt_exam_participants
  ADD COLUMN IF NOT EXISTS regular_class_id uuid,
  ADD COLUMN IF NOT EXISTS additional_class_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cbt_exam_participants_regular_class_fk'
      AND conrelid = 'public.cbt_exam_participants'::regclass
  ) THEN
    ALTER TABLE public.cbt_exam_participants
      ADD CONSTRAINT cbt_exam_participants_regular_class_fk
      FOREIGN KEY (regular_class_id) REFERENCES public.cbt_classes(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cbt_exam_participants_additional_class_fk'
      AND conrelid = 'public.cbt_exam_participants'::regclass
  ) THEN
    ALTER TABLE public.cbt_exam_participants
      ADD CONSTRAINT cbt_exam_participants_additional_class_fk
      FOREIGN KEY (additional_class_id) REFERENCES public.cbt_additional_classes(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cbt_exam_participants_one_class_source'
      AND conrelid = 'public.cbt_exam_participants'::regclass
  ) THEN
    ALTER TABLE public.cbt_exam_participants
      ADD CONSTRAINT cbt_exam_participants_one_class_source
      CHECK (num_nonnulls(regular_class_id, additional_class_id) <= 1) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cbt_exam_participants
  VALIDATE CONSTRAINT cbt_exam_participants_regular_class_fk;
ALTER TABLE public.cbt_exam_participants
  VALIDATE CONSTRAINT cbt_exam_participants_additional_class_fk;
ALTER TABLE public.cbt_exam_participants
  VALIDATE CONSTRAINT cbt_exam_participants_one_class_source;

CREATE INDEX IF NOT EXISTS cbt_exam_participants_regular_class_idx
  ON public.cbt_exam_participants (regular_class_id)
  WHERE regular_class_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cbt_exam_participants_additional_class_idx
  ON public.cbt_exam_participants (additional_class_id)
  WHERE additional_class_id IS NOT NULL;

COMMIT;
