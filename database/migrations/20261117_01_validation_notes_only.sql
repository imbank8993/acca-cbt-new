-- =============================================================================
-- Validasi bank soal: aturan "Tanpa persetujuan (catatan saja)".
-- =============================================================================
--
-- * `approval_rule = 'notes_only'`: validator hanya memberi catatan; tidak ada
--   rekomendasi Layak/Revisi/Tolak dan tidak ada keputusan Admin/Proktor.
-- * `status = 'reviewed'` ("Selesai ditelaah"): status akhir sesi catatan saja
--   setelah seluruh validator mengirim telaahnya.
--
-- Aman dijalankan ulang: constraint lama dicari berdasarkan isinya lalu diganti.
-- =============================================================================

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cbt_question_bank_validations'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%(approval_rule)%'
        OR pg_get_constraintdef(oid) ILIKE '%(status)%')
  LOOP
    EXECUTE format('ALTER TABLE public.cbt_question_bank_validations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cbt_question_bank_validations
  ADD CONSTRAINT cbt_question_bank_validations_approval_rule_check
  CHECK (approval_rule IN ('unanimous', 'any', 'admin_decides', 'notes_only'));

ALTER TABLE public.cbt_question_bank_validations
  ADD CONSTRAINT cbt_question_bank_validations_status_check
  CHECK (status IN ('pending', 'in_progress', 'revision_needed', 'resubmitted', 'approved', 'rejected', 'reviewed'));

COMMIT;
