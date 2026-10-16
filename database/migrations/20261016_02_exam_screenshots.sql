BEGIN;

ALTER TABLE public.cbt_pas_periods ADD COLUMN IF NOT EXISTS screenshot_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.cbt_exam_screenshots (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES public.cbt_exam_attempts(id) ON DELETE CASCADE,
  event_id uuid NOT NULL UNIQUE REFERENCES public.cbt_attempt_security_logs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  object_key text,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 204800),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS cbt_exam_screenshots_attempt_idx ON public.cbt_exam_screenshots(attempt_id, created_at);
CREATE INDEX IF NOT EXISTS cbt_exam_screenshots_expiry_idx ON public.cbt_exam_screenshots(expires_at) WHERE deleted_at IS NULL;

COMMIT;
