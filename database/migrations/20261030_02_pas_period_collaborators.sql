BEGIN;
CREATE TABLE IF NOT EXISTS public.cbt_pas_period_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.cbt_pas_periods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('viewer', 'editor', 'manager')),
  granted_by uuid NOT NULL REFERENCES public.cbt_profiles(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, user_id)
);
CREATE INDEX IF NOT EXISTS cbt_pas_period_collaborators_user_idx ON public.cbt_pas_period_collaborators(user_id);
ALTER TABLE public.cbt_pas_period_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cbt_collaboration_events DROP CONSTRAINT IF EXISTS cbt_collaboration_events_resource_type_check;
ALTER TABLE public.cbt_collaboration_events ADD CONSTRAINT cbt_collaboration_events_resource_type_check CHECK (resource_type IN ('bank', 'exam', 'period'));
COMMIT;
