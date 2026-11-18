-- Stage F1: cache confident answers for repeated questions.
-- ghostchat_ tables only.

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS knowledge_rev integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.ghostchat_answer_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  query_hash text NOT NULL,
  query_norm text NOT NULL,
  answer text NOT NULL,
  sources jsonb,
  suggestions jsonb,
  knowledge_rev integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, query_hash, knowledge_rev)
);

CREATE INDEX IF NOT EXISTS ghostchat_answer_cache_site_idx
  ON public.ghostchat_answer_cache (site_id, knowledge_rev);

ALTER TABLE public.ghostchat_answer_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_answer_cache FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_answer_cache TO service_role;

COMMENT ON TABLE public.ghostchat_answer_cache IS
  'Cached confident answers for repeated questions. Invalidated by knowledge_rev.';
