-- Audio narasi untuk bahan ajar HTML ("video" berbasis HTML).
-- Audio disimpan di R2 (prefix lms-private/), bukan di dalam content_html.
ALTER TABLE public.cbt_learning_materials ADD COLUMN IF NOT EXISTS narration_key TEXT;
ALTER TABLE public.cbt_learning_materials ADD COLUMN IF NOT EXISTS narration_name TEXT;
ALTER TABLE public.cbt_learning_materials ADD COLUMN IF NOT EXISTS narration_size INTEGER;
