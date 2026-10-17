BEGIN;

-- Workflow Persetujuan Dokumen Administrasi:
-- Pengawas mengisi Berita Acara & Daftar Hadir lalu Submit (status: 'submitted').
-- Pembuat ujian / Proktor mereview dan melakukan ACC menjadi dokumen resmi (status: 'approved').
-- Dokumen lama otomatis berstatus 'approved' agar tetap sah dan valid.

ALTER TABLE public.cbt_pas_administration_reports
    ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'approved'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejection_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS cbt_pas_admin_reports_status_idx
    ON public.cbt_pas_administration_reports (pas_period_id, status);

COMMIT;
