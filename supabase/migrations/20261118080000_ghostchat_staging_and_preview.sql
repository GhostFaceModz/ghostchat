-- Stage F3+F8: recrawl preview/diff and a staging/test widget.
-- ghostchat_ tables only.

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS staging_site_key text,
  ADD COLUMN IF NOT EXISTS staging_chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preview_status text;

CREATE UNIQUE INDEX IF NOT EXISTS ghostchat_sites_staging_site_key_idx
  ON public.ghostchat_sites (staging_site_key)
  WHERE staging_site_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ghostchat_crawl_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'unchanged', 'error')),
  trigger text NOT NULL DEFAULT 'manual',
  added integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  pages integer NOT NULL DEFAULT 0,
  chunks integer NOT NULL DEFAULT 0,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  faq_candidates jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ghostchat_crawl_previews_site_idx
  ON public.ghostchat_crawl_previews (site_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ghostchat_crawl_previews_one_pending
  ON public.ghostchat_crawl_previews (site_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.ghostchat_crawl_previews IS
  'Proposed recrawl results waiting for owner approval. Unchanged crawls are stored as status=unchanged.';

CREATE TABLE IF NOT EXISTS public.ghostchat_staging_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  preview_id uuid REFERENCES public.ghostchat_crawl_previews(id) ON DELETE CASCADE,
  filename text NOT NULL,
  source_type text NOT NULL,
  source_url text,
  byte_size integer,
  chunk_count integer NOT NULL DEFAULT 0,
  content_hash text,
  replaces_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_staging_documents_site_idx
  ON public.ghostchat_staging_documents (site_id);

CREATE TABLE IF NOT EXISTS public.ghostchat_staging_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.ghostchat_staging_documents(id) ON DELETE CASCADE,
  preview_id uuid REFERENCES public.ghostchat_crawl_previews(id) ON DELETE CASCADE,
  url text,
  title text,
  heading text,
  content text NOT NULL,
  token_count integer,
  source_type text NOT NULL DEFAULT 'crawl',
  embedding extensions.vector(384),
  embedding_model text,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(heading, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_staging_chunks_site_idx
  ON public.ghostchat_staging_chunks (site_id);
CREATE INDEX IF NOT EXISTS ghostchat_staging_chunks_document_idx
  ON public.ghostchat_staging_chunks (document_id);
CREATE INDEX IF NOT EXISTS ghostchat_staging_chunks_embedding_idx
  ON public.ghostchat_staging_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS ghostchat_staging_chunks_tsv_idx
  ON public.ghostchat_staging_chunks USING gin (tsv);

ALTER TABLE public.ghostchat_crawl_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_staging_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_staging_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ghostchat_crawl_previews FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_staging_documents FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_staging_chunks FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_crawl_previews TO service_role;
GRANT ALL ON TABLE public.ghostchat_staging_documents TO service_role;
GRANT ALL ON TABLE public.ghostchat_staging_chunks TO service_role;

CREATE OR REPLACE FUNCTION public.ghostchat_hybrid_staging_chunks(
  query_embedding extensions.vector(384),
  query_text text,
  match_site_id uuid,
  match_count integer DEFAULT 6,
  match_threshold double precision DEFAULT 0.2
)
RETURNS TABLE (
  id uuid,
  site_id uuid,
  url text,
  title text,
  content text,
  heading text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  WITH semantic AS (
    SELECT
      c.id,
      row_number() OVER (ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding) AS rank,
      (1 - (c.embedding OPERATOR(extensions.<=>) query_embedding))::double precision AS sim
    FROM public.ghostchat_staging_chunks c
    WHERE c.site_id = match_site_id
      AND c.embedding IS NOT NULL
      AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
    ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT greatest(match_count * 4, 12)
  ),
  kw AS (
    SELECT
      c.id,
      row_number() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC) AS rank,
      ts_rank_cd(c.tsv, q)::double precision AS sim
    FROM public.ghostchat_staging_chunks c,
         websearch_to_tsquery('simple', coalesce(query_text, '')) q
    WHERE c.site_id = match_site_id
      AND query_text IS NOT NULL
      AND length(trim(query_text)) > 0
      AND c.tsv @@ q
    ORDER BY ts_rank_cd(c.tsv, q) DESC
    LIMIT greatest(match_count * 4, 12)
  ),
  fused AS (
    SELECT id, sum(score) AS score, max(sim) AS sim
    FROM (
      SELECT id, 1.0 / (60 + rank) AS score, sim FROM semantic
      UNION ALL
      SELECT id, 1.0 / (60 + rank) AS score, sim FROM kw
    ) s
    GROUP BY id
  )
  SELECT
    c.id,
    c.site_id,
    c.url,
    c.title,
    c.content,
    c.heading,
    f.sim AS similarity
  FROM fused f
  JOIN public.ghostchat_staging_chunks c ON c.id = f.id
  ORDER BY f.score DESC, f.sim DESC
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.ghostchat_hybrid_staging_chunks(extensions.vector, text, uuid, integer, double precision) FROM anon, authenticated, PUBLIC;
GRANT ALL ON FUNCTION public.ghostchat_hybrid_staging_chunks(extensions.vector, text, uuid, integer, double precision) TO service_role;
