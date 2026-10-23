-- Pengawas ruang bergilir setiap hari: penugasan kini per ruang × sesi × TANGGAL,
-- sama seperti berita acara dan daftar hadir (cbt_pas_administration_reports).
--
-- Penugasan lama (ruang × sesi, tanpa tanggal) disalin ke setiap tanggal dalam
-- rentang folder ditambah tanggal jadwal yang memakai sesi itu, lalu baris tanpa
-- tanggal dihapus. Dengan begitu tidak ada ruang yang tiba-tiba tanpa pengawas;
-- proktor tinggal mengganti hari yang memang bergilir. Baris yang sama sekali
-- tidak dapat diberi tanggal tetap tersimpan sebagai catatan tidak aktif.
--
-- Satu orang tidak boleh bertugas di dua ruang pada tanggal & sesi yang sama;
-- aturan itu dijaga oleh layanan API (data lama mungkin sudah melanggarnya).
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.cbt_pas_room_invigilators ADD COLUMN IF NOT EXISTS exam_date date;

DROP INDEX IF EXISTS public.cbt_pas_room_session_invigilator_unique;

WITH legacy AS (
    SELECT inv.pas_room_id, inv.session_id, inv.user_id, inv.created_at, r.pas_period_id
    FROM public.cbt_pas_room_invigilators inv
    JOIN public.cbt_pas_rooms r ON r.id = inv.pas_room_id
    WHERE inv.session_id IS NOT NULL AND inv.exam_date IS NULL
), dates AS (
    SELECT p.id AS pas_period_id, NULL::uuid AS session_id, d::date AS exam_date
    FROM public.cbt_pas_periods p
    CROSS JOIN LATERAL generate_series(p.start_date::date, p.end_date::date, interval '1 day') AS d
    WHERE p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date::date <= p.end_date::date
    UNION
    SELECT sc.pas_period_id, sc.session_id, sc.scheduled_date::date
    FROM public.cbt_pas_class_schedules sc
    WHERE sc.scheduled_date IS NOT NULL
)
INSERT INTO public.cbt_pas_room_invigilators (pas_room_id, session_id, user_id, created_at, exam_date)
SELECT DISTINCT legacy.pas_room_id, legacy.session_id, legacy.user_id, legacy.created_at, dates.exam_date
FROM legacy
JOIN dates ON dates.pas_period_id = legacy.pas_period_id
          AND (dates.session_id IS NULL OR dates.session_id = legacy.session_id);

DELETE FROM public.cbt_pas_room_invigilators undated
WHERE undated.session_id IS NOT NULL AND undated.exam_date IS NULL
  AND EXISTS (
      SELECT 1 FROM public.cbt_pas_room_invigilators dated
      WHERE dated.pas_room_id = undated.pas_room_id AND dated.session_id = undated.session_id
        AND dated.user_id = undated.user_id AND dated.exam_date IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_room_session_date_invigilator_unique
    ON public.cbt_pas_room_invigilators (pas_room_id, session_id, exam_date, user_id)
    WHERE session_id IS NOT NULL AND exam_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS cbt_pas_invigilators_user_date_session
    ON public.cbt_pas_room_invigilators (user_id, exam_date, session_id, pas_room_id);

COMMIT;
