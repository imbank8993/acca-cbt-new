-- Aturan penskoran Benar-Salah & Kategorisasi.
--
-- Mulai sekarang satu soal B/S atau Kategorisasi dinilai sebagai SATU soal
-- (Kepdirjen Pendis 781/2021; Desain Pengembangan Soal AKM 2020):
--   * ≤ 5 pernyataan : semua benar → skor penuh, selain itu 0;
--   * > 5 pernyataan : semua benar → penuh, salah 1–2 → setengah, salah > 2 → 0.
-- Ujian tanpa penanda di bawah memakai aturan ini (bawaan).
--
-- Ujian yang SUDAH memiliki pengerjaan tetap memakai aturan lama (proporsional:
-- benar ÷ jumlah pernyataan) supaya nilai yang sudah ada tidak bergeser bila
-- dinilai ulang lewat koreksi kunci atau suntingan bank soal. Penandanya
-- dicap NestJS pada salinan soal beku (lihat apps/api/src/common/complex-scoring.ts).
--
-- Jalankan migrasi ini SEBELUM layanan scoring/API versi baru dijalankan.
-- Aman dijalankan ulang: ujian yang sudah punya penanda tidak disentuh.
BEGIN;
SET LOCAL lock_timeout = '2s';

UPDATE public.cbt_exams e
SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('complex_scoring_rule', 'proportional')
WHERE NOT (COALESCE(e.metadata, '{}'::jsonb) ? 'complex_scoring_rule')
  AND EXISTS (SELECT 1 FROM public.cbt_exam_attempts a WHERE a.exam_id = e.id);

COMMIT;
