BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_exam_screen_share_exceptions (
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 240),
  created_by uuid REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, user_id)
);

CREATE INDEX IF NOT EXISTS cbt_exam_screen_share_exceptions_user_idx
  ON public.cbt_exam_screen_share_exceptions(user_id, exam_id);

COMMIT;
