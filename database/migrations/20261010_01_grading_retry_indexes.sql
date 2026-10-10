-- Supports background recovery of both manual-submit and auto-submit scoring failures.
-- Optional performance indexes; the application does not require a new column.
CREATE INDEX IF NOT EXISTS cbt_attempts_pending_grading_all_idx
    ON public.cbt_exam_attempts (finished_at, id)
    WHERE status IN ('submitted', 'auto_submitted') AND total_score IS NULL;

CREATE INDEX IF NOT EXISTS cbt_attempts_relative_grading_pending_idx
    ON public.cbt_exam_attempts (exam_id)
    WHERE status IN ('submitted', 'auto_submitted') AND total_score IS NOT NULL
      AND metadata->>'relative_scoring_pending' = 'true';
