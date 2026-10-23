BEGIN;

ALTER TABLE public.cbt_exams ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.cbt_touch_collaborative_resource()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER cbt_exams_collaboration_version
BEFORE UPDATE ON public.cbt_exams FOR EACH ROW EXECUTE FUNCTION public.cbt_touch_collaborative_resource();
CREATE OR REPLACE TRIGGER cbt_banks_collaboration_version
BEFORE UPDATE ON public.cbt_question_banks FOR EACH ROW EXECUTE FUNCTION public.cbt_touch_collaborative_resource();

CREATE TABLE IF NOT EXISTS public.cbt_bank_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES public.cbt_question_banks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('viewer', 'editor', 'manager')),
  granted_by uuid NOT NULL REFERENCES public.cbt_profiles(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, user_id)
);
CREATE INDEX IF NOT EXISTS cbt_bank_collaborators_user_idx ON public.cbt_bank_collaborators(user_id);

CREATE TABLE IF NOT EXISTS public.cbt_exam_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('viewer', 'editor', 'manager')),
  can_reset boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL REFERENCES public.cbt_profiles(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, user_id),
  CHECK (permission <> 'viewer' OR can_reset = false)
);
CREATE INDEX IF NOT EXISTS cbt_exam_collaborators_user_idx ON public.cbt_exam_collaborators(user_id);

-- Retain the access history even after a resource has been deleted.
CREATE TABLE IF NOT EXISTS public.cbt_collaboration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('bank', 'exam')),
  resource_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  previous_access jsonb,
  new_access jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbt_collaboration_events_resource_idx
  ON public.cbt_collaboration_events(resource_type, resource_id, created_at);

ALTER TABLE public.cbt_bank_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbt_exam_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbt_collaboration_events ENABLE ROW LEVEL SECURITY;

COMMIT;
