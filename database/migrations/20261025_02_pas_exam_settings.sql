-- Pengaturan ujian folder ASAS/ASAT/AM: bawaan folder + timpaan per bank soal.
-- Bentuk: { "defaults": { ... }, "banks": { "<bank_id>": { ... } } }
-- Kosong ('{}') = perilaku lama: acak soal & opsi, nilai dan pembahasan tertutup,
-- mode aman aktif dengan batas 3 pelanggaran, berbagi layar mengikuti screenshot_enabled.
BEGIN;

ALTER TABLE public.cbt_pas_periods
    ADD COLUMN IF NOT EXISTS exam_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
