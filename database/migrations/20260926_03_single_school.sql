BEGIN;

-- Instalasi ACCA CBT ini hanya melayani satu sekolah. Jangan memilih atau
-- menghapus sekolah secara otomatis bila data lama berisi lebih dari satu:
-- operator harus memeriksa dan menggabungkan datanya terlebih dahulu.
DO $$
DECLARE
  school_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO school_count
  FROM public.cbt_organizations;

  IF school_count > 1 THEN
    RAISE EXCEPTION
      'Migrasi single-school dibatalkan: ditemukan % sekolah pada cbt_organizations',
      school_count
      USING HINT = 'Gabungkan data ke satu sekolah sebelum menjalankan migrasi ini.';
  END IF;
END
$$;

-- Semua baris menghasilkan nilai TRUE yang sama, sehingga PostgreSQL hanya
-- mengizinkan nol atau satu baris sekolah. Foreign key organization_id pada
-- tabel lain tetap dipertahankan sebagai pengikat data internal.
CREATE UNIQUE INDEX IF NOT EXISTS cbt_organizations_singleton
  ON public.cbt_organizations ((true));

COMMIT;
