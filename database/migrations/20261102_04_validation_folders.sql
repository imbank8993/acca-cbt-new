-- Kelompok sesi validasi, misalnya ASAS 2026. Sesi lama tetap tanpa folder.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_validation_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.cbt_organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cbt_validation_folders_id_org_unique UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cbt_validation_folders_org_name_unique
  ON public.cbt_validation_folders (organization_id, lower(btrim(name)));

ALTER TABLE public.cbt_question_bank_validations ADD COLUMN IF NOT EXISTS folder_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cbt_question_bank_validations'::regclass
        AND conname = 'cbt_validations_folder_org_fkey') THEN
    ALTER TABLE public.cbt_question_bank_validations
      ADD CONSTRAINT cbt_validations_folder_org_fkey FOREIGN KEY (folder_id, organization_id)
      REFERENCES public.cbt_validation_folders(id, organization_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cbt_validations_folder_idx
  ON public.cbt_question_bank_validations (folder_id);

ALTER TABLE public.cbt_validation_folders ENABLE ROW LEVEL SECURITY;

COMMIT;
