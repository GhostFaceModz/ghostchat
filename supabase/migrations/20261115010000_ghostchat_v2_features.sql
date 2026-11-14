-- GhostChat v2: analytics helpers, "fix this answer" corrections, auto re-crawl, live site lookup,
-- proactive greetings, in-chat forms, visitor memory, language, white label and Meta channel scaffolding.
-- Only ghostchat_-prefixed objects are touched (shared project).

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS recrawl_schedule text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS live_lookup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lookup_search_url text,
  ADD COLUMN IF NOT EXISTS greetings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chat_form jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS memory_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS multilingual boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS custom_domain text,
  ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_recrawl_schedule_check CHECK (recrawl_schedule IN ('off','daily','weekly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Change detection for re-crawls and live lookups.
ALTER TABLE public.ghostchat_documents ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.ghostchat_documents DROP CONSTRAINT IF EXISTS ghostchat_documents_source_type_check;
ALTER TABLE public.ghostchat_documents ADD CONSTRAINT ghostchat_documents_source_type_check
  CHECK (source_type IN ('crawl', 'upload', 'paste', 'pdf', 'notion', 'lookup'));
CREATE INDEX IF NOT EXISTS ghostchat_documents_site_url_idx ON public.ghostchat_documents (site_id, source_url);

-- Owner corrections from the chat logs ("Fix this answer"): high-priority Q&A used in retrieval.
CREATE TABLE IF NOT EXISTS public.ghostchat_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  log_id uuid,
  question text NOT NULL,
  answer text NOT NULL,
  embedding extensions.vector(384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ghostchat_corrections_site_idx ON public.ghostchat_corrections (site_id, created_at DESC);
ALTER TABLE public.ghostchat_corrections ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ghostchat_corrections IS 'GhostChat owner-corrected answers (high-priority Q&A for retrieval). Server-only.';

CREATE OR REPLACE FUNCTION public.ghostchat_match_corrections(
  query_embedding extensions.vector(384),
  match_site_id uuid,
  match_count integer DEFAULT 2,
  match_threshold double precision DEFAULT 0.5
)
RETURNS TABLE (id uuid, question text, answer text, similarity double precision)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT c.id, c.question, c.answer,
    (1 - (c.embedding OPERATOR(extensions.<=>) query_embedding))::double precision AS similarity
  FROM public.ghostchat_corrections c
  WHERE c.site_id = match_site_id AND c.embedding IS NOT NULL
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;
REVOKE ALL ON FUNCTION public.ghostchat_match_corrections(extensions.vector, uuid, integer, double precision) FROM PUBLIC, anon, authenticated;

-- Returning-visitor memory (anonymous visitor id from the widget; visitors can opt out / forget).
CREATE TABLE IF NOT EXISTS public.ghostchat_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  visitor_id text NOT NULL,
  visits integer NOT NULL DEFAULT 1,
  last_session_id text,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, visitor_id)
);
ALTER TABLE public.ghostchat_visitors ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ghostchat_visitors IS 'GhostChat anonymous returning-visitor preferences. No emails or names. Server-only.';

-- Language of each visitor message (for analytics and replies).
ALTER TABLE public.ghostchat_logs ADD COLUMN IF NOT EXISTS lang text;
