-- Integritas sesi dan jadwal PAS/PAT.
-- Sesi yang sudah dipakai tidak boleh hilang dan setiap jadwal harus menunjuk
-- sesi dari periode yang sama.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cbt_pas_sessions
    WHERE pas_period_id IS NULL OR end_time <= start_time
  ) THEN
    RAISE EXCEPTION 'Sesi PAS tanpa periode atau dengan jam tidak valid ditemukan; tinjau sebelum migrasi.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cbt_pas_class_schedules
    WHERE pas_period_id IS NULL
       OR session_id IS NULL
       OR window_end_time <= scheduled_time
       OR duration_minutes IS NULL
       OR duration_minutes < 1
  ) THEN
    RAISE EXCEPTION 'Jadwal PAS tanpa periode/sesi atau dengan waktu/durasi tidak valid ditemukan; tinjau sebelum migrasi.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cbt_pas_class_schedules schedule
      JOIN public.cbt_pas_sessions session_row ON session_row.id = schedule.session_id
     WHERE session_row.pas_period_id <> schedule.pas_period_id
  ) THEN
    RAISE EXCEPTION 'Jadwal PAS menunjuk sesi dari periode berbeda; tinjau sebelum migrasi.';
  END IF;
END $$;

ALTER TABLE public.cbt_pas_sessions
  ALTER COLUMN pas_period_id SET NOT NULL;

ALTER TABLE public.cbt_pas_class_schedules
  ALTER COLUMN pas_period_id SET NOT NULL,
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN duration_minutes SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_sessions'::regclass
      AND conname = 'cbt_pas_sessions_valid_time'
  ) THEN
    ALTER TABLE public.cbt_pas_sessions
      ADD CONSTRAINT cbt_pas_sessions_valid_time CHECK (end_time > start_time) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_class_schedules'::regclass
      AND conname = 'cbt_pas_schedules_valid_time'
  ) THEN
    ALTER TABLE public.cbt_pas_class_schedules
      ADD CONSTRAINT cbt_pas_schedules_valid_time
      CHECK (window_end_time > scheduled_time) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_class_schedules'::regclass
      AND conname = 'cbt_pas_schedules_duration_positive'
  ) THEN
    ALTER TABLE public.cbt_pas_class_schedules
      ADD CONSTRAINT cbt_pas_schedules_duration_positive
      CHECK (duration_minutes > 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cbt_pas_sessions
  VALIDATE CONSTRAINT cbt_pas_sessions_valid_time;
ALTER TABLE public.cbt_pas_class_schedules
  VALIDATE CONSTRAINT cbt_pas_schedules_valid_time;
ALTER TABLE public.cbt_pas_class_schedules
  VALIDATE CONSTRAINT cbt_pas_schedules_duration_positive;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_sessions_id_period_unique
  ON public.cbt_pas_sessions (id, pas_period_id);

ALTER TABLE public.cbt_pas_class_schedules
  DROP CONSTRAINT IF EXISTS cbt_pas_class_schedules_session_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_class_schedules'::regclass
      AND conname = 'cbt_pas_schedules_session_period_fkey'
  ) THEN
    ALTER TABLE public.cbt_pas_class_schedules
      ADD CONSTRAINT cbt_pas_schedules_session_period_fkey
      FOREIGN KEY (session_id, pas_period_id)
      REFERENCES public.cbt_pas_sessions (id, pas_period_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cbt_pas_class_schedules
  VALIDATE CONSTRAINT cbt_pas_schedules_session_period_fkey;

CREATE INDEX IF NOT EXISTS cbt_pas_schedules_session_period_idx
  ON public.cbt_pas_class_schedules (session_id, pas_period_id);

COMMIT;

