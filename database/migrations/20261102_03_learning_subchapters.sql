BEGIN;
ALTER TABLE public.cbt_learning_materials
    ADD COLUMN IF NOT EXISTS subtopic_order integer NOT NULL DEFAULT 0 CHECK (subtopic_order >= 0);
CREATE INDEX IF NOT EXISTS cbt_learning_materials_chapter
    ON public.cbt_learning_materials (organization_id, grade_level, subject, topic, subtopic_order);
COMMIT;
