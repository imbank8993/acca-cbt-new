-- =============================================================================
-- Tabel CBT yang belum ada di acca_db
-- =============================================================================
--
-- acca_db sudah memuat 45 tabel cbt_* hasil restore database Supabase, tetapi
-- kode CBT merujuk beberapa tabel lain yang tidak ikut terbawa.
--
-- Bentuk tabel di sini diturunkan dari pemakaian kolom di kode, karena
-- database/schema.sql tidak pernah memuat definisinya. Bila database CBT
-- Supabase yang masih berjalan sudah punya tabel-tabel ini, jangan pakai berkas
-- ini: dump tabel aslinya, itu selalu lebih tepat daripada hasil penurunan.
-- Lihat docs/MIGRASI_DATABASE.md.
--
-- Tabel untuk fitur blog/CMS, token, dan langganan SENGAJA TIDAK ADA di sini.
-- Ketiganya berasal dari produk asal aplikasi ini dan sudah dihapus dari kode —
-- lihat docs/PEMBERSIHAN_UNELMA.md.
--
-- Seluruh pernyataan bersifat idempoten — aman dijalankan ulang.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Administrator platform ───────────────────────────────────────────────────
-- Dirujuk lib/rbac.ts, lib/server-authz.ts, dan /api/check-platform-admin.
-- Tanpa tabel ini, penentuan peran Admin/Superadmin diam-diam selalu gagal dan
-- pengguna terlempar ke dasbor yang salah.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_email
  ON public.platform_admins (lower(email));

-- ── Pengaturan aplikasi (key/value) ──────────────────────────────────────────
-- Menyimpan konfigurasi penyimpanan berkas (key 'storage_config') dan
-- pengaturan tampilan (key 'app_config').
--
-- Dulu bernama `unelma_settings`. Lingkungan yang di-restore dari Supabase
-- sudah punya tabel itu BESERTA DATANYA, jadi di sana yang benar adalah
-- mengganti nama — bukan membuat tabel kosong baru yang membuat konfigurasi
-- penyimpanan berkas hilang.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'unelma_settings')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = 'acca_settings')
  THEN
    ALTER TABLE public.unelma_settings RENAME TO acca_settings;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acca_settings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  value        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Tahun ajaran per organisasi ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_years (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.cbt_organizations (id) ON DELETE CASCADE,
  year            text NOT NULL,
  start_date      date,
  end_date        date,
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_years_org_year_unique UNIQUE (organization_id, year)
);

CREATE INDEX IF NOT EXISTS idx_school_years_org_active
  ON public.school_years (organization_id, is_active);

-- ── Kategori bank soal ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.cbt_organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_categories_org
  ON public.bank_categories (organization_id);

-- ── Penugasan ujian ke kelas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id    uuid NOT NULL REFERENCES public.cbt_exams (id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES public.cbt_classes (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_classes_exam_class_unique UNIQUE (exam_id, class_id)
);

-- ── Konfigurasi ujian massal (PAS/PAT) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.cbt_organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  school_year     text,
  semester        text,
  start_date      date,
  end_date        date,
  created_by      uuid REFERENCES public.cbt_profiles (id) ON DELETE SET NULL,
  is_locked       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_configs_org
  ON public.exam_configs (organization_id);

CREATE TABLE IF NOT EXISTS public.exam_config_banks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_config_id   uuid NOT NULL REFERENCES public.exam_configs (id) ON DELETE CASCADE,
  bank_id          uuid NOT NULL REFERENCES public.cbt_question_banks (id) ON DELETE CASCADE,
  subject_id       uuid REFERENCES public.cbt_subjects (id) ON DELETE SET NULL,
  duration_minutes integer NOT NULL DEFAULT 90,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_config_banks_config
  ON public.exam_config_banks (exam_config_id);

CREATE TABLE IF NOT EXISTS public.exam_config_exams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_config_id      uuid NOT NULL REFERENCES public.exam_configs (id) ON DELETE CASCADE,
  exam_config_bank_id uuid NOT NULL REFERENCES public.exam_config_banks (id) ON DELETE CASCADE,
  class_id            uuid NOT NULL REFERENCES public.cbt_classes (id) ON DELETE CASCADE,
  -- Terisi setelah ujian benar-benar dibangkitkan dari konfigurasi ini.
  -- ON DELETE SET NULL, bukan CASCADE: menghapus ujian hasil generate tidak
  -- boleh ikut menghapus baris jadwalnya.
  exam_id             uuid REFERENCES public.cbt_exams (id) ON DELETE SET NULL,
  scheduled_date      date,
  scheduled_time      time,
  window_end_time     time,
  status              text NOT NULL DEFAULT 'scheduled',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_config_exams_config
  ON public.exam_config_exams (exam_config_id);
CREATE INDEX IF NOT EXISTS idx_exam_config_exams_exam
  ON public.exam_config_exams (exam_id);

COMMIT;
