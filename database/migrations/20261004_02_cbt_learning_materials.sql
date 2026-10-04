-- LMS: drafts are private to their author/admin; published materials serve the school.
CREATE TABLE IF NOT EXISTS public.cbt_learning_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    created_by UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subject VARCHAR(100) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    format VARCHAR(16) NOT NULL DEFAULT 'attachment' CHECK (format IN ('html', 'word', 'latex', 'text', 'pdf', 'image', 'audio', 'video', 'attachment')),
    content_html TEXT NOT NULL DEFAULT '',
    conversion_notes TEXT NOT NULL DEFAULT '',
    file_key TEXT,
    file_name TEXT,
    file_size INTEGER,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cbt_learning_materials_school_status ON public.cbt_learning_materials (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS cbt_learning_materials_author ON public.cbt_learning_materials (created_by, organization_id);
CREATE TABLE IF NOT EXISTS public.cbt_learning_progress (
    material_id UUID NOT NULL REFERENCES public.cbt_learning_materials(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (material_id, user_id)
);
