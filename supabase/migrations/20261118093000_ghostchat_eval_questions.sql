-- Stage G1: training eval set (must-get-right questions).
-- ghostchat_ tables only.

CREATE TABLE IF NOT EXISTS public.ghostchat_eval_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  question text NOT NULL,
  expect text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_eval_questions_site_idx
  ON public.ghostchat_eval_questions (site_id, sort, created_at);

ALTER TABLE public.ghostchat_eval_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_eval_questions FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_eval_questions TO service_role;

COMMENT ON TABLE public.ghostchat_eval_questions IS
  'Owner-authored test questions and expected phrases, run against training before publish.';
