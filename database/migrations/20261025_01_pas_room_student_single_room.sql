-- Satu siswa hanya boleh menempati SATU ruang dalam satu folder ujian (periode PAS).
--
-- API (PasRoomsService.assignStudents) sudah menolak siswa yang berada di ruang
-- lain kecuali proktor memilih "Pindahkan". Indeks unik ini menjadi pengaman
-- terakhir di basis data: jalur lain (pemulihan backup, skrip, permintaan
-- bersamaan) tidak dapat lagi membuat penempatan ganda.
--
-- Bila migrasi berhenti karena data ganda, lihat daftarnya dengan:
--   SELECT p.name AS folder, s.user_id, array_agg(r.name ORDER BY r.name) AS ruang
--     FROM public.cbt_pas_room_students s
--     JOIN public.cbt_pas_rooms r ON r.id = s.pas_room_id
--     JOIN public.cbt_pas_periods p ON p.id = s.pas_period_id
--    GROUP BY p.name, s.pas_period_id, s.user_id
--   HAVING count(*) > 1;
-- lalu keluarkan siswa tersebut dari salah satu ruang (tab Ruang) dan jalankan ulang.
BEGIN;
SET LOCAL lock_timeout = '2s';

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
    FROM (
      SELECT pas_period_id, user_id
        FROM public.cbt_pas_room_students
       GROUP BY pas_period_id, user_id
      HAVING count(*) > 1
    ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION '% siswa ditempatkan di lebih dari satu ruang pada folder yang sama; rapikan dulu (lihat kueri di kepala berkas).', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_room_students_period_user_unique
  ON public.cbt_pas_room_students (pas_period_id, user_id);

COMMIT;
