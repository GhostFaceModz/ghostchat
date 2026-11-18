-- Hybrid (keyword + semantic) search support, plus FAQ drafts for owner approval.
ALTER TABLE public.ghostchat_chunks
  ADD COLUMN IF NOT EXISTS heading text;

ALTER TABLE public.ghostchat_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(heading, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS ghostchat_chunks_tsv_idx
  ON public.ghostchat_chunks USING gin (tsv);

CREATE OR REPLACE FUNCTION public.ghostchat_hybrid_chunks(
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
    FROM public.ghostchat_chunks c
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
    FROM public.ghostchat_chunks c,
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
    coalesce(f.sim, 0)::double precision AS similarity
  FROM fused f
  JOIN public.ghostchat_chunks c ON c.id = f.id
  ORDER BY f.score DESC, f.sim DESC
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.ghostchat_hybrid_chunks(extensions.vector, text, uuid, integer, double precision) FROM anon, authenticated, PUBLIC;
GRANT ALL ON FUNCTION public.ghostchat_hybrid_chunks(extensions.vector, text, uuid, integer, double precision) TO service_role;

CREATE TABLE IF NOT EXISTS public.ghostchat_faq_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  source_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_faq_drafts_site_status_idx
  ON public.ghostchat_faq_drafts (site_id, status, created_at DESC);

ALTER TABLE public.ghostchat_faq_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_faq_drafts FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_faq_drafts TO service_role;

COMMENT ON TABLE public.ghostchat_faq_drafts IS
  'Auto-generated FAQ drafts from a crawled site, pending owner approval.';
