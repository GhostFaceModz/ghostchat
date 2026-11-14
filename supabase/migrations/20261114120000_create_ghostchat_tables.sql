-- GhostChat schema
-- Isolated to ghostchat_* objects only. Does not touch any existing tables
-- (no public.profiles, ghostflix_*, ghostgames_/gg_*, ghostlinks_*, etc.).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.ghostchat_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ghostchat_owners_email_format CHECK (position('@' in email) > 1)
);

CREATE UNIQUE INDEX ghostchat_owners_email_lower_idx
  ON public.ghostchat_owners (lower(email));

COMMENT ON TABLE public.ghostchat_owners IS
  'GhostChat dashboard owners. Separate from shared auth / public.profiles.';

CREATE TABLE public.ghostchat_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My site',
  url text NOT NULL,
  site_key text NOT NULL,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  greeting text,
  persona text,
  tone text NOT NULL DEFAULT 'friendly',
  guardrails text,
  banned_topics text[] NOT NULL DEFAULT '{}',
  starter_questions text[] NOT NULL DEFAULT '{}',
  proactive_delay_ms integer NOT NULL DEFAULT 4000,
  sound_default boolean NOT NULL DEFAULT false,
  show_branding boolean NOT NULL DEFAULT true,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business')),
  messages_this_period integer NOT NULL DEFAULT 0,
  leads_this_period integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT date_trunc('month', timezone('utc', now())),
  crawl_status text NOT NULL DEFAULT 'idle',
  crawl_error text,
  last_crawled_at timestamptz,
  page_count integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ghostchat_sites_site_key_key UNIQUE (site_key)
);

CREATE INDEX ghostchat_sites_owner_id_idx ON public.ghostchat_sites (owner_id);

COMMENT ON TABLE public.ghostchat_sites IS
  'GhostChat sites. site_key is the public widget key. plan/usage fields are ready for Whop tiers.';

CREATE TABLE public.ghostchat_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  filename text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('crawl', 'upload', 'paste')),
  source_url text,
  byte_size integer,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ghostchat_documents_site_id_idx ON public.ghostchat_documents (site_id);

COMMENT ON TABLE public.ghostchat_documents IS
  'GhostChat training sources (crawled pages and owner-uploaded docs).';

CREATE TABLE public.ghostchat_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.ghostchat_documents(id) ON DELETE CASCADE,
  url text,
  title text,
  content text NOT NULL,
  token_count integer,
  source_type text NOT NULL DEFAULT 'crawl',
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ghostchat_chunks_site_id_idx ON public.ghostchat_chunks (site_id);
CREATE INDEX ghostchat_chunks_document_id_idx ON public.ghostchat_chunks (document_id);
CREATE INDEX ghostchat_chunks_embedding_idx
  ON public.ghostchat_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

COMMENT ON TABLE public.ghostchat_chunks IS
  'GhostChat retrieved content chunks with pgvector embeddings (1536-d, text-embedding-3-small).';

CREATE TABLE public.ghostchat_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message text NOT NULL,
  sources jsonb,
  was_unsure boolean NOT NULL DEFAULT false,
  feedback text CHECK (feedback IS NULL OR feedback IN ('up', 'down')),
  page_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ghostchat_logs_site_created_idx
  ON public.ghostchat_logs (site_id, created_at DESC);
CREATE INDEX ghostchat_logs_site_session_idx
  ON public.ghostchat_logs (site_id, session_id);
CREATE INDEX ghostchat_logs_unanswered_idx
  ON public.ghostchat_logs (site_id, created_at DESC)
  WHERE was_unsure = true AND role = 'assistant';
CREATE INDEX ghostchat_logs_page_url_idx
  ON public.ghostchat_logs (site_id, page_url)
  WHERE page_url IS NOT NULL;

COMMENT ON TABLE public.ghostchat_logs IS
  'GhostChat chat transcripts. Messages are PII-redacted before insert.';

CREATE TABLE public.ghostchat_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  session_id text,
  email text NOT NULL,
  name text,
  notes text,
  transcript text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ghostchat_leads_site_created_idx
  ON public.ghostchat_leads (site_id, created_at DESC);

COMMENT ON TABLE public.ghostchat_leads IS
  'GhostChat emails captured from the widget (human handoff / lead capture).';

CREATE OR REPLACE FUNCTION public.ghostchat_match_chunks(
  query_embedding extensions.vector(1536),
  match_site_id uuid,
  match_count integer DEFAULT 6,
  match_threshold double precision DEFAULT 0.72
)
RETURNS TABLE (
  id uuid,
  site_id uuid,
  url text,
  title text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.site_id,
    c.url,
    c.title,
    c.content,
    (1 - (c.embedding OPERATOR(extensions.<=>) query_embedding))::double precision AS similarity
  FROM public.ghostchat_chunks c
  WHERE c.site_id = match_site_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) IS
  'GhostChat similarity search, scoped to a single site_id for data isolation.';

ALTER TABLE public.ghostchat_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_leads ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies. The API uses the service role only.
REVOKE ALL ON TABLE public.ghostchat_owners FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_sites FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_documents FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_chunks FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_logs FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_leads FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) FROM anon, authenticated, PUBLIC;

GRANT ALL ON TABLE public.ghostchat_owners TO service_role;
GRANT ALL ON TABLE public.ghostchat_sites TO service_role;
GRANT ALL ON TABLE public.ghostchat_documents TO service_role;
GRANT ALL ON TABLE public.ghostchat_chunks TO service_role;
GRANT ALL ON TABLE public.ghostchat_logs TO service_role;
GRANT ALL ON TABLE public.ghostchat_leads TO service_role;
GRANT ALL ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) TO service_role;
