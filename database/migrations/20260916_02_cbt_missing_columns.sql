-- =============================================================================
-- Kolom yang dirujuk kode CBT tetapi tidak ada di acca_db
-- =============================================================================
--
-- Ditemukan dengan menjalankan 291 select hasil ekstraksi dari kode CBT ke
-- acca_db.
--
-- PENTING — kolom-kolom ini juga TIDAK ADA di database/schema.sql, artinya
-- kemungkinannya ada dua:
--
--   (a) Kolom ditambahkan langsung di dasbor Supabase tanpa pernah masuk repo.
--       Berkas ini menyusulkannya.
--   (b) Kolomnya memang tidak pernah ada, dan query yang merujuknya sudah gagal
--       diam-diam selama ini. Pemanggilnya menulis `const { data } = await ...`
--       tanpa memeriksa `error`, jadi kegagalannya tidak pernah terlihat.
--
-- Bandingkan dengan Supabase CBT yang masih berjalan sebelum menjalankan ini.
-- Daftar kegagalannya ada di docs/MIGRASI_DATABASE.md.
--
-- `cbt_profiles.token_balance` sengaja TIDAK ada di sini: fitur token berasal
-- dari produk asal aplikasi dan sudah dihapus — lihat docs/PEMBERSIHAN_UNELMA.md.
-- =============================================================================

BEGIN;

-- ── cbt_profiles ─────────────────────────────────────────────────────────────

-- Dirujuk analytics.ts untuk menampilkan peserta. Sumber kebenaran email tetap
-- auth.users; kolom ini salinan untuk menghindari join lintas schema di layar
-- analitik.
ALTER TABLE public.cbt_profiles
  ADD COLUMN IF NOT EXISTS email text;

-- Dirujuk getExamAnswersForAnalysisAction (nomor peserta pada lembar analisis).
ALTER TABLE public.cbt_profiles
  ADD COLUMN IF NOT EXISTS unique_id text;

-- Dirujuk /api/storage/config.
ALTER TABLE public.cbt_profiles
  ADD COLUMN IF NOT EXISTS role text;

-- Isi awal email dari auth.users. Hanya baris yang masih kosong yang disentuh,
-- sehingga aman dijalankan ulang.
UPDATE public.cbt_profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id
   AND p.email IS NULL
   AND u.email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cbt_profiles_email
  ON public.cbt_profiles (lower(email));

-- ── cbt_organization_members ─────────────────────────────────────────────────

-- Dirujuk apps/web/components/Sidebar.tsx dan /api/storage/config, yang juga
-- melakukan .order('role').
--
-- Perlu diperhatikan: sumber kebenaran peran adalah cbt_member_roles →
-- cbt_roles, dan seluruh penentuan peran memakai jalur itu. Kolom ini
-- didenormalisasi dan akan basi. Sebaiknya kedua pemanggilnya diubah memakai
-- relasi cbt_member_roles, lalu kolom ini dibuang.
ALTER TABLE public.cbt_organization_members
  ADD COLUMN IF NOT EXISTS role text;

COMMIT;
