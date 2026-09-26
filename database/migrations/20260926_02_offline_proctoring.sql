-- ANS-07: heartbeat peserta dan deduplikasi event pengawasan hasil retry.

BEGIN;

ALTER TABLE public.cbt_exam_attempts
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE public.cbt_exam_attempts
SET last_seen_at = COALESCE(started_at, now())
WHERE status = 'in_progress' AND last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS cbt_exam_attempts_active_last_seen
  ON public.cbt_exam_attempts (exam_id, last_seen_at)
  WHERE status = 'in_progress';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cbt_attempt_security_logs
    WHERE metadata ? 'client_event_id'
    GROUP BY attempt_id, metadata->>'client_event_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Migrasi dibatalkan: ada client_event_id pengawasan yang duplikat.',
      HINT = 'Tinjau duplikat cbt_attempt_security_logs sebelum menjalankan migrasi kembali.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_security_logs_client_event_unique
  ON public.cbt_attempt_security_logs (attempt_id, (metadata->>'client_event_id'))
  WHERE metadata ? 'client_event_id';

COMMIT;
