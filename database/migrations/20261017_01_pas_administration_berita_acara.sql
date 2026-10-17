-- Administrasi Ujian PAS/PAT: Berita Acara Pelaksanaan & Daftar Hadir Peserta per Tanggal, Ruang, dan Sesi
-- Dilengkapi kode verifikasi unik dan hash tanda tangan digital untuk verifikasi keaslian dokumen A4.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_pas_administration_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.cbt_organizations(id) ON DELETE CASCADE,
    pas_period_id UUID NOT NULL REFERENCES public.cbt_pas_periods(id) ON DELETE CASCADE,
    pas_room_id UUID NOT NULL REFERENCES public.cbt_pas_rooms(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.cbt_pas_sessions(id) ON DELETE CASCADE,
    exam_date DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT 'Pelaksanaan ujian berjalan dengan tertib, aman, dan lancar.',
    incident_summary TEXT NOT NULL DEFAULT 'Tidak ada kendala atau insiden khusus.',
    invigilator_id UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    invigilator_name TEXT NOT NULL DEFAULT '',
    proctor_id UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    proctor_name TEXT NOT NULL DEFAULT '',
    verification_code VARCHAR(64) NOT NULL UNIQUE,
    attendance_verification_code VARCHAR(64) NOT NULL UNIQUE,
    signature_hash TEXT NOT NULL DEFAULT '',
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cbt_pas_admin_reports_unique_slot UNIQUE (pas_period_id, pas_room_id, session_id, exam_date)
);

CREATE INDEX IF NOT EXISTS cbt_pas_admin_reports_period_idx
    ON public.cbt_pas_administration_reports (pas_period_id, exam_date);

CREATE INDEX IF NOT EXISTS cbt_pas_admin_reports_room_session_idx
    ON public.cbt_pas_administration_reports (pas_room_id, session_id, exam_date);

CREATE TABLE IF NOT EXISTS public.cbt_pas_student_attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pas_period_id UUID NOT NULL REFERENCES public.cbt_pas_periods(id) ON DELETE CASCADE,
    pas_room_id UUID NOT NULL REFERENCES public.cbt_pas_rooms(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.cbt_pas_sessions(id) ON DELETE CASCADE,
    exam_date DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES public.cbt_profiles(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'hadir' CHECK (status IN ('hadir', 'sakit', 'izin', 'alpha')),
    remark TEXT NOT NULL DEFAULT '',
    updated_by UUID REFERENCES public.cbt_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cbt_pas_student_attendances_unique_student UNIQUE (pas_period_id, pas_room_id, session_id, exam_date, user_id)
);

CREATE INDEX IF NOT EXISTS cbt_pas_student_attendances_slot_idx
    ON public.cbt_pas_student_attendances (pas_period_id, pas_room_id, session_id, exam_date);

COMMIT;
