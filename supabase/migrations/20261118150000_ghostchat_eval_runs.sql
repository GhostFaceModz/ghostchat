-- Stage I1: store each eval-set run so owners can diff against the previous run.
-- ghostchat_ tables only.

CREATE TABLE IF NOT EXISTS public.ghostchat_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  staging boolean NOT NULL DEFAULT false,
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_eval_runs_site_idx
  ON public.ghostchat_eval_runs (site_id, staging, created_at DESC);

ALTER TABLE public.ghostchat_eval_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_eval_runs FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_eval_runs TO service_role;

COMMENT ON TABLE public.ghostchat_eval_runs IS
  'Snapshots of eval-set runs against live or staging training, used to show better/worse diffs.';
