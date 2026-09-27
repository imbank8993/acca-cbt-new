-- Retry aman untuk entitas turunan dan pengaman race pada jadwal.

BEGIN;

ALTER TABLE public.school_years
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.bank_folders
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_organization_labels
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_pas_sessions
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_pas_rooms
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.cbt_pas_class_schedules
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.exam_config_banks
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;
ALTER TABLE public.exam_config_exams
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS school_years_client_request_unique
  ON public.school_years (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_folders_client_request_unique
  ON public.bank_folders (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_organization_labels_client_request_unique
  ON public.cbt_organization_labels (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_sessions_client_request_unique
  ON public.cbt_pas_sessions (pas_period_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_rooms_client_request_unique
  ON public.cbt_pas_rooms (pas_period_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_class_schedules_client_request_unique
  ON public.cbt_pas_class_schedules (pas_period_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exam_config_banks_client_request_unique
  ON public.exam_config_banks (exam_config_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exam_config_exams_client_request_unique
  ON public.exam_config_exams (exam_config_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Pemeriksaan service lama tidak atomik. Jangan memilih salah satu duplikat
-- secara otomatis karena setiap baris mungkin sudah mempunyai relasi turunan.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cbt_pas_class_schedules
    GROUP BY pas_period_id, bank_id, class_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplikat jadwal PAS ditemukan; tinjau sebelum migrasi.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.exam_config_banks
    GROUP BY exam_config_id, bank_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplikat bank konfigurasi ditemukan; tinjau sebelum migrasi.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.exam_config_exams
    GROUP BY exam_config_id, exam_config_bank_id, class_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplikat jadwal konfigurasi ditemukan; tinjau sebelum migrasi.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_schedule_business_unique
  ON public.cbt_pas_class_schedules (pas_period_id, bank_id, class_id);
CREATE UNIQUE INDEX IF NOT EXISTS exam_config_banks_business_unique
  ON public.exam_config_banks (exam_config_id, bank_id);
CREATE UNIQUE INDEX IF NOT EXISTS exam_config_exams_business_unique
  ON public.exam_config_exams (exam_config_id, exam_config_bank_id, class_id);

COMMIT;
