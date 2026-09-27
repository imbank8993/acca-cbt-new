-- Jembatani master_mapel (bigint) dengan cbt_subjects (UUID) yang direferensikan
-- oleh jadwal, konfigurasi, ujian, dan analitik CBT.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cbt_subjects WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'Mata pelajaran CBT tanpa sekolah ditemukan; tinjau sebelum migrasi.';
  END IF;
END $$;

ALTER TABLE public.cbt_subjects
  ADD COLUMN IF NOT EXISTS master_mapel_id bigint,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.cbt_subjects
  ALTER COLUMN organization_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_subjects_org_master_unique
  ON public.cbt_subjects (organization_id, master_mapel_id);

CREATE INDEX IF NOT EXISTS cbt_subjects_org_active_idx
  ON public.cbt_subjects (organization_id, name)
  WHERE is_active;

-- Aplikasi ini dikunci ke satu sekolah. UUID dibuat oleh default tabel dan
-- dipertahankan oleh unique key di atas pada setiap sinkronisasi berikutnya.
INSERT INTO public.cbt_subjects (
  organization_id,
  master_mapel_id,
  name,
  code,
  color,
  is_active
)
SELECT
  organization_row.id,
  master.id,
  master.nama,
  master.kode,
  (ARRAY[
    '#4f46e5', '#0284c7', '#0891b2', '#059669', '#65a30d',
    '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea'
  ])[((abs(master.id) % 10) + 1)::int],
  COALESCE(master.aktif, true)
FROM public.master_mapel master
CROSS JOIN LATERAL (
  SELECT id FROM public.cbt_organizations ORDER BY created_at, id LIMIT 1
) organization_row
ON CONFLICT (organization_id, master_mapel_id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  color = EXCLUDED.color,
  is_active = EXCLUDED.is_active;

COMMIT;

