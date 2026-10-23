-- Versi ujian untuk formulir kolaborator hanya berubah karena suntingan pengguna.
--
-- Trigger dari 20261023_02 memperbarui cbt_exams.updated_at pada SETIAP update,
-- termasuk penulisan sistem (penilaian, koreksi kunci, metadata penutupan).
-- Akibatnya editor yang formulirnya terbuka mendapat "telah diubah oleh pengguna
-- lain" padahal tidak ada orang lain yang mengubah. ExamAdminService.update kini
-- menetapkan updated_at sendiri. Trigger bank soal dipertahankan: perubahan bank
-- (soal, impor) berasal dari pengguna.
BEGIN;
DROP TRIGGER IF EXISTS cbt_exams_collaboration_version ON public.cbt_exams;
COMMIT;
