BEGIN;
ALTER TABLE public.cbt_pas_administration_reports ADD COLUMN IF NOT EXISTS document_snapshot jsonb;
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_administration_reports'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\msignature_version\M'
  LOOP
    EXECUTE format('ALTER TABLE public.cbt_pas_administration_reports DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;
ALTER TABLE public.cbt_pas_administration_reports ADD CONSTRAINT cbt_pas_admin_signature_version_check CHECK (signature_version IN (1, 2, 3));
COMMIT;
