-- Pengacakan soal berkelompok (stimulus yang sama / metadata.group_key yang sama).
--
-- Ujian yang SUDAH punya attempt tetap memakai urutan lama: urutan soal siswa
-- dihitung ulang setiap kali halaman ujian/review dibuka, jadi algoritma baru
-- akan menggeser nomor soal pada ujian yang sedang/sudah dikerjakan.
-- Ujian baru (dan ujian tanpa attempt) otomatis memakai pengacakan berkelompok.
--
-- Jalankan SEKALI, bersamaan dengan deploy API yang memuat fitur ini.

BEGIN;

UPDATE public.cbt_exams AS e
SET metadata = COALESCE(e.metadata, '{}'::jsonb) || '{"question_order": "legacy"}'::jsonb
WHERE EXISTS (SELECT 1 FROM public.cbt_exam_attempts a WHERE a.exam_id = e.id)
  AND NOT (COALESCE(e.metadata, '{}'::jsonb) ? 'question_order');

COMMIT;
