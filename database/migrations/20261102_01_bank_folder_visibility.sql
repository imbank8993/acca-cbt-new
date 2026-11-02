-- =============================================================================
-- Folder bank soal: pribadi secara bawaan, publik bila pembuatnya memilih.
-- =============================================================================
--
-- Folder hanya terlihat oleh pembuatnya (dan Admin) kecuali `is_public` true.
-- Mengubah nama, status publik, dan menghapus folder hanya boleh oleh pembuat
-- atau Admin (diperiksa di QuestionBanksService).
-- =============================================================================

BEGIN;

ALTER TABLE public.bank_folders
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Folder lama tanpa pembuat tidak punya pemilik yang dapat melihatnya;
-- jadikan publik supaya tidak hilang dari daftar siapa pun selain Admin.
UPDATE public.bank_folders SET is_public = true WHERE created_by IS NULL AND is_public = false;

CREATE INDEX IF NOT EXISTS bank_folders_org_creator_idx
  ON public.bank_folders (organization_id, created_by);

-- Karena folder kini pribadi, nama cukup unik per pembuat. Bila ada batasan
-- unik lama pada (organization_id, name), guru tidak bisa membuat folder
-- bernama sama dengan folder pribadi guru lain yang tidak terlihat olehnya.
-- Batasan itu (bila ada) diganti dengan keunikan per pembuat.
DO $$
DECLARE
  r record;
  dropped boolean := false;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.bank_folders'::regclass
      AND c.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(c.conkey) AS k(attnum)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
          = ARRAY['name', 'organization_id']
  LOOP
    EXECUTE format('ALTER TABLE public.bank_folders DROP CONSTRAINT %I', r.conname);
    dropped := true;
  END LOOP;

  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx
    FROM pg_index i
    WHERE i.indrelid = 'public.bank_folders'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indexprs IS NULL
      AND i.indpred IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(i.indkey::int2[]) AS k(attnum)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
          = ARRAY['name', 'organization_id']
  LOOP
    EXECUTE format('DROP INDEX %s', r.idx);
    dropped := true;
  END LOOP;

  IF dropped THEN
    CREATE UNIQUE INDEX IF NOT EXISTS bank_folders_owner_name_unique
      ON public.bank_folders (organization_id, created_by, name);
  END IF;
END $$;

COMMIT;
