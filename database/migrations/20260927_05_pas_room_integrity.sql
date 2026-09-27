-- Integritas struktural penugasan ruang PAS/PAT.
-- Service tetap memeriksa kapasitas dinamis dan peran pengguna; constraint ini
-- menjaga aturan yang dapat dibuktikan langsung dari satu/dua tabel.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cbt_pas_rooms
    WHERE capacity IS NULL OR capacity < 1
  ) THEN
    RAISE EXCEPTION 'Ruang PAS dengan kapasitas kosong/tidak positif ditemukan; tinjau sebelum migrasi.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cbt_pas_room_students student
      JOIN public.cbt_pas_rooms room ON room.id = student.pas_room_id
     WHERE student.pas_period_id <> room.pas_period_id
  ) THEN
    RAISE EXCEPTION 'Penugasan siswa menunjuk ruang dari periode berbeda; tinjau sebelum migrasi.';
  END IF;
END $$;

ALTER TABLE public.cbt_pas_rooms
  ALTER COLUMN capacity SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_rooms'::regclass
      AND conname = 'cbt_pas_rooms_capacity_positive'
  ) THEN
    ALTER TABLE public.cbt_pas_rooms
      ADD CONSTRAINT cbt_pas_rooms_capacity_positive CHECK (capacity > 0);
  END IF;
END $$;

-- PostgreSQL memerlukan key unik pada pasangan kolom yang menjadi tujuan FK.
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_rooms_id_period_unique
  ON public.cbt_pas_rooms (id, pas_period_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cbt_pas_room_students'::regclass
      AND conname = 'cbt_pas_room_students_room_period_fkey'
  ) THEN
    ALTER TABLE public.cbt_pas_room_students
      ADD CONSTRAINT cbt_pas_room_students_room_period_fkey
      FOREIGN KEY (pas_room_id, pas_period_id)
      REFERENCES public.cbt_pas_rooms (id, pas_period_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cbt_pas_room_students
  VALIDATE CONSTRAINT cbt_pas_room_students_room_period_fkey;

COMMIT;
