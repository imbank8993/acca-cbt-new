BEGIN;

-- Pembatalan ujian (mis. salah jadwal padahal siswa sudah mulai mengerjakan).
-- Seluruh pengerjaan ujian itu dipindahkan ke arsip ini lalu dihapus, sehingga
-- siswa dapat mengerjakan ulang dari awal dan nilai lama tidak muncul di rekap.
-- Arsip menyimpan baris asli (attempt, jawaban, log pengawasan, dll.) sebagai
-- JSON untuk audit atau pemulihan manual.
CREATE TABLE IF NOT EXISTS public.cbt_exam_cancellations (
  id uuid PRIMARY KEY,
  exam_id uuid NOT NULL,
  exam_title text,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  cancelled_by uuid REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  in_progress_count integer NOT NULL DEFAULT 0,
  answer_count integer NOT NULL DEFAULT 0,
  previous_exam jsonb NOT NULL DEFAULT '{}'::jsonb,
  exam_rows jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cbt_exam_cancellations_exam_idx
  ON public.cbt_exam_cancellations(exam_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cbt_exam_cancelled_attempts (
  attempt_id uuid PRIMARY KEY,
  cancellation_id uuid NOT NULL REFERENCES public.cbt_exam_cancellations(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text,
  attempt jsonb NOT NULL,
  related jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cbt_exam_cancelled_attempts_user_idx
  ON public.cbt_exam_cancelled_attempts(user_id, exam_id);
CREATE INDEX IF NOT EXISTS cbt_exam_cancelled_attempts_cancellation_idx
  ON public.cbt_exam_cancelled_attempts(cancellation_id);

COMMIT;
