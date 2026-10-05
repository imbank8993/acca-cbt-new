ALTER TABLE public.cbt_learning_materials ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.cbt_learning_progress ADD COLUMN IF NOT EXISTS completed_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS public.cbt_learning_activity (
    material_id UUID NOT NULL REFERENCES public.cbt_learning_materials(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    content_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    state JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(material_id, user_id, content_version),
    CHECK (octet_length(state::text) <= 262144)
);
