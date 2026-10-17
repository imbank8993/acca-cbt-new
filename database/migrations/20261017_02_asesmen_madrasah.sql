BEGIN;

-- Constraint names may retain their original names after the cbt_ rename.
DO $$
DECLARE
  target record;
  existing record;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('cbt_pas_periods', 'type', ARRAY['pas','pat','pts','pkn','am']),
    ('cbt_exams', 'exam_type', ARRAY['daily','pas','pat','pts','pkn','am','lainnya','assignment','tryout','quiz'])
  ) AS targets(table_name, column_name, allowed_values)
  LOOP
    FOR existing IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = format('public.%I', target.table_name)::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ~ ('\m' || target.column_name || '\M')
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target.table_name, existing.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = ANY (%L::text[]))',
      target.table_name, target.table_name || '_' || target.column_name || '_check',
      target.column_name, target.allowed_values);
  END LOOP;
END $$;

COMMIT;
