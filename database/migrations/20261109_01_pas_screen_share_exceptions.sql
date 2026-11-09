BEGIN;

-- Pengecualian berbagi layar untuk satu siswa di SELURUH ujian sebuah periode
-- ASAS/ASAT/AM (folder PAS). Melengkapi cbt_exam_screen_share_exceptions yang
-- berlaku per ujian. Ujian termasuk periode bila ada jadwal kelas periode itu
-- yang menunjuk exam_id-nya (cbt_pas_class_schedules).
CREATE TABLE IF NOT EXISTS public.cbt_pas_screen_share_exceptions (
  pas_period_id uuid NOT NULL REFERENCES public.cbt_pas_periods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 240),
  created_by uuid REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pas_period_id, user_id)
);

CREATE INDEX IF NOT EXISTS cbt_pas_screen_share_exceptions_user_idx
  ON public.cbt_pas_screen_share_exceptions(user_id, pas_period_id);

COMMIT;
