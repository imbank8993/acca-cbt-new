-- =============================================================================
-- Menambahkan kolom updated_at pada cbt_question_banks dan bank_folders
-- =============================================================================
--
-- Diperlukan oleh:
-- 1. apps/api/src/imports/imports.service.ts (memperbarui timestamp bank setelah impor batch soal)
-- 2. apps/api/src/questions/questions.service.ts:touchBank() (memperbarui timestamp bank saat soal diubah)
-- 3. apps/api/src/questions/question-banks.service.ts:updateFolder() (memperbarui timestamp folder)
-- =============================================================================

BEGIN;

ALTER TABLE public.cbt_question_banks
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.bank_folders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

COMMIT;
