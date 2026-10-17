BEGIN;

ALTER TABLE public.cbt_pas_administration_reports
    ADD COLUMN IF NOT EXISTS committee_chair_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS committee_chair_nip text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS proctor_nip text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS signature_version smallint NOT NULL DEFAULT 1
        CHECK (signature_version IN (1, 2));

-- Existing signatures remain version 1. New saves snapshot all three signers
-- using version 2; changing settings must never rewrite a signed document.

COMMIT;
