-- Assign invigilators to a room AND session. Legacy assignments are copied to
-- each existing session; unscoped rows without any session remain as dormant records.
BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.cbt_pas_room_invigilators ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.cbt_pas_room_invigilators
  DROP CONSTRAINT IF EXISTS cbt_pas_room_invigilators_pas_room_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_room_session_invigilator_unique
  ON public.cbt_pas_room_invigilators (pas_room_id, session_id, user_id)
  WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbt_pas_room_legacy_invigilator_unique
  ON public.cbt_pas_room_invigilators (pas_room_id, user_id) WHERE session_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cbt_pas_room_invigilators'::regclass
                 AND conname = 'cbt_pas_room_invigilators_session_id_fkey') THEN
    ALTER TABLE public.cbt_pas_room_invigilators
      ADD CONSTRAINT cbt_pas_room_invigilators_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.cbt_pas_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_pas_invigilator_session_period()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cbt_pas_rooms r JOIN public.cbt_pas_sessions s
      ON s.pas_period_id = r.pas_period_id
    WHERE r.id = NEW.pas_room_id AND s.id = NEW.session_id
  ) THEN
    RAISE EXCEPTION 'Ruang dan sesi pengawas harus berada dalam periode yang sama.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cbt_pas_invigilator_session_period ON public.cbt_pas_room_invigilators;
CREATE TRIGGER cbt_pas_invigilator_session_period
  BEFORE INSERT OR UPDATE OF pas_room_id, session_id ON public.cbt_pas_room_invigilators
  FOR EACH ROW EXECUTE FUNCTION public.check_pas_invigilator_session_period();

INSERT INTO public.cbt_pas_room_invigilators (pas_room_id, session_id, user_id, created_at)
SELECT old.pas_room_id, s.id, old.user_id, old.created_at
FROM public.cbt_pas_room_invigilators old
JOIN public.cbt_pas_rooms r ON r.id = old.pas_room_id
JOIN public.cbt_pas_sessions s ON s.pas_period_id = r.pas_period_id
WHERE old.session_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM public.cbt_pas_room_invigilators old
USING public.cbt_pas_rooms r
WHERE old.session_id IS NULL AND r.id = old.pas_room_id
  AND EXISTS (SELECT 1 FROM public.cbt_pas_sessions s WHERE s.pas_period_id = r.pas_period_id);

CREATE INDEX IF NOT EXISTS cbt_pas_invigilators_user_session
  ON public.cbt_pas_room_invigilators (user_id, session_id, pas_room_id);
COMMIT;
