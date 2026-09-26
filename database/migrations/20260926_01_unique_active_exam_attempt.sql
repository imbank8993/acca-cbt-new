-- ANS-05: satu siswa hanya boleh mempunyai satu attempt aktif per ujian.
--
-- Service memakai advisory transaction lock agar dua request start yang tiba
-- bersamaan kembali ke attempt yang sama. Index ini menjadi perlindungan akhir
-- bagi penulis lain atau versi service lama yang masih berjalan saat rollout.
--
-- Duplikat lama tidak dihapus otomatis karena masing-masing mungkin mempunyai
-- jawaban. Audit dan selesaikan datanya lebih dahulu agar riwayat siswa tidak
-- hilang diam-diam.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cbt_exam_attempts
    WHERE status = 'in_progress'
    GROUP BY exam_id, user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Migrasi dibatalkan: ada attempt aktif ganda pada cbt_exam_attempts.',
      HINT = 'Tinjau jawaban setiap attempt, finalkan duplikat yang tidak dipakai, lalu jalankan migrasi kembali.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_exam_attempts_one_active_per_user_exam
  ON public.cbt_exam_attempts (exam_id, user_id)
  WHERE status = 'in_progress';

COMMIT;
