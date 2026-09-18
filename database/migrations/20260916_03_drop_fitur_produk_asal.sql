-- =============================================================================
-- Hapus tabel & kolom sisa fitur produk asal — BAGIAN AMAN
-- =============================================================================
--
-- Fitur blog/CMS, langganan, dan pembayaran sudah dihapus dari kode CBT —
-- lihat docs/PEMBERSIHAN_UNELMA.md. Berkas ini membereskan sisanya di database.
--
-- PENTING — `acca_db` DIPAKAI BERSAMA acca-new.
--
-- Seluruh isi berkas ini sudah diperiksa terhadap KEDUA basis kode. Yang masih
-- dirujuk acca-new dipindahkan ke berkas 04, yang butuh keputusan tersendiri.
--
-- Lima tabel di bawah muncul di `apps/api/prisma/schema.prisma` milik acca-new,
-- tetapi HANYA di sana — hasil introspeksi, tanpa satu pun pemanggilan di kode.
-- Prisma tidak memvalidasi skema saat berjalan, jadi menghapusnya tidak
-- membuat acca-new gagal. Yang perlu dilakukan setelahnya hanyalah menjalankan
-- ulang `prisma db pull` di sana agar skemanya tidak basi.
--
-- PENGHAPUSAN INI PERMANEN. Jalankan hanya setelah:
--   1. kode hasil pembersihan sudah ter-deploy, dan
--   2. dump cutover dari Supabase sudah dimuat ke acca_db.
--
-- Urutannya mengikuti ketergantungan foreign key dan SENGAJA tanpa CASCADE:
-- bila ternyata masih ada yang merujuk salah satu tabel, migrasi harus GAGAL
-- dengan jelas — bukan diam-diam ikut menghapus tabel yang tak disangka.
--
-- Seluruh pernyataan memakai IF EXISTS sehingga aman dijalankan ulang, dan aman
-- pada lingkungan yang memang tidak pernah punya tabelnya.
-- =============================================================================

BEGIN;

-- ── Langganan & pembayaran ───────────────────────────────────────────────────
-- Di acca_db ketiganya ADA dan KOSONG (0 baris).
-- cbt_payments menunjuk cbt_organization_subscriptions, yang menunjuk
-- cbt_subscription_plans — jadi dihapus dari anak ke induk.
DROP TABLE IF EXISTS public.cbt_payments;
DROP TABLE IF EXISTS public.cbt_organization_subscriptions;
DROP TABLE IF EXISTS public.cbt_subscription_plans;

-- Berasal dari Supabase, belum ada di acca_db sampai dump cutover dimuat.
-- Nol rujukan di kedua basis kode.
DROP TABLE IF EXISTS public.cbt_payment_transactions;
DROP TABLE IF EXISTS public.user_subscriptions;
DROP TABLE IF EXISTS public.user_token_purchases;

-- ── Katalog izin yang tidak pernah terpakai ──────────────────────────────────
-- cbt_permissions (11 baris) dan cbt_role_permissions (24 baris) BERISI data,
-- tetapi nol pemanggilan di kedua basis kode: otorisasi CBT berjalan lewat
-- cbt_member_roles → cbt_roles, bukan lewat katalog izin ini. Keduanya sisa
-- rancangan produk asal yang tidak pernah disambungkan.
DROP TABLE IF EXISTS public.cbt_role_permissions;
DROP TABLE IF EXISTS public.cbt_permissions;

-- ── Blog/CMS ─────────────────────────────────────────────────────────────────
-- Nol rujukan di kedua basis kode. Tabel penghubung lebih dulu.
DROP TABLE IF EXISTS public.unelma_post_category_links;
DROP TABLE IF EXISTS public.unelma_post_tag_links;
DROP TABLE IF EXISTS public.unelma_posts;
DROP TABLE IF EXISTS public.unelma_post_categories;
DROP TABLE IF EXISTS public.unelma_post_tags;

-- ── Kolom yatim ──────────────────────────────────────────────────────────────
-- Kosong di acca_db dan nol rujukan di kedua basis kode.
ALTER TABLE public.cbt_organizations DROP COLUMN IF EXISTS hero_image_url;

-- ── Sengaja TIDAK dihapus di sini ────────────────────────────────────────────
--
-- Fitur token & ujian berbayar (cbt_token_transactions, cbt_unlocked_exams,
--   cbt_profiles.token_balance, cbt_exams.is_paid, cbt_exams.token_price)
--   masih dirujuk KODE acca-new. Lihat berkas 04.
--
-- cbt_organizations.max_students
--   Tidak dirujuk kode, tetapi terisi pada satu-satunya baris organisasi dan
--   bisa jadi batas yang memang dikehendaki sekolah — bukan sisa produk asal.
--
-- cbt_organization_labels   — masih dipakai app/actions/question.ts.
-- cbt_certificates          — masih dipakai lewat konstanta DETACH_TABLES di
--                             apps/api/src/exams/exams.service.ts.
-- acca_settings             — konfigurasi penyimpanan berkas; di-RENAME di
--                             migrasi 01, BUKAN dihapus.

COMMIT;
