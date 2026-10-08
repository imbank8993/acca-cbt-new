-- CBT: Validasi Bank Soal & Validasi Butir Soal oleh Validator Guru
-- Mendukung multi-validator, penandaan teks (highlight & note per butir), serta catatan umum/kesimpulan.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_question_bank_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.cbt_organizations(id) ON DELETE CASCADE,
    bank_id UUID NOT NULL REFERENCES public.cbt_question_banks(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    deadline TIMESTAMPTZ,
    approval_rule VARCHAR(32) NOT NULL DEFAULT 'unanimous' CHECK (approval_rule IN ('unanimous', 'any', 'admin_decides')),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'revision_needed', 'approved', 'rejected')),
    allow_edit_during_exam BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cbt_qbank_validations_org_status 
    ON public.cbt_question_bank_validations (organization_id, status);
CREATE INDEX IF NOT EXISTS cbt_qbank_validations_bank_idx 
    ON public.cbt_question_bank_validations (bank_id);

CREATE TABLE IF NOT EXISTS public.cbt_question_bank_validators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_id UUID NOT NULL REFERENCES public.cbt_question_bank_validations(id) ON DELETE CASCADE,
    validator_id UUID NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'submitted')),
    general_recommendation VARCHAR(32) CHECK (general_recommendation IN ('approved', 'revision_needed', 'rejected')),
    general_comment TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cbt_qbank_validators_unique_pair UNIQUE (validation_id, validator_id)
);

CREATE INDEX IF NOT EXISTS cbt_qbank_validators_user_status 
    ON public.cbt_question_bank_validators (validator_id, status);

CREATE TABLE IF NOT EXISTS public.cbt_question_validation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_id UUID NOT NULL REFERENCES public.cbt_question_bank_validations(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.cbt_bank_questions(id) ON DELETE CASCADE,
    validator_id UUID NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
    target_scope VARCHAR(32) NOT NULL DEFAULT 'question_text' CHECK (target_scope IN ('question_text', 'stimulus', 'option', 'general')),
    target_option_id UUID REFERENCES public.cbt_bank_question_options(id) ON DELETE SET NULL,
    selected_text TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'typo' CHECK (category IN ('typo', 'materi', 'kunci_jawaban', 'konstruksi', 'bahasa', 'lainnya')),
    status_item VARCHAR(32) NOT NULL DEFAULT 'revision' CHECK (status_item IN ('valid', 'revision', 'rejected')),
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_by UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cbt_qval_notes_val_q_idx 
    ON public.cbt_question_validation_notes (validation_id, question_id);
CREATE INDEX IF NOT EXISTS cbt_qval_notes_q_resolved_idx 
    ON public.cbt_question_validation_notes (question_id, is_resolved);

COMMIT;
