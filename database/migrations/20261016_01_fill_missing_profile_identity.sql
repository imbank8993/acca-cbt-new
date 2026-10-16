BEGIN;

-- Only allow an empty identity to be filled with the identity of the same
-- authenticated account in master. Existing identities and names stay locked.
CREATE OR REPLACE FUNCTION public.profiles_immutable_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.is_admin', true) = 'true' THEN
      RETURN NEW;
    END IF;
    IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
      RAISE EXCEPTION 'Cannot modify full_name after user creation. Contact system administrator.';
    END IF;
    IF OLD.identity_number IS DISTINCT FROM NEW.identity_number THEN
      IF NULLIF(btrim(OLD.identity_number), '') IS NULL
         AND NULLIF(btrim(NEW.identity_number), '') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.users u
           WHERE u.auth_id = OLD.id AND btrim(u.nip) = NEW.identity_number
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Cannot modify identity_number (NISN/NIP) after user creation. Contact system administrator.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.cbt_profiles p
SET identity_number = btrim(u.nip)
FROM public.users u
WHERE u.auth_id = p.id
  AND NULLIF(btrim(p.identity_number), '') IS NULL
  AND NULLIF(btrim(u.nip), '') IS NOT NULL;

COMMIT;
