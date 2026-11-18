-- Stage G6: soft-delete recycle bin for training documents. ghostchat_ tables only.

ALTER TABLE public.ghostchat_documents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS ghostchat_documents_site_deleted_idx
  ON public.ghostchat_documents (site_id, deleted_at);

COMMENT ON COLUMN public.ghostchat_documents.deleted_at IS
  'When set, the document is in the recycle bin and is excluded from live answers until restored or purged after 7 days.';

CREATE OR REPLACE FUNCTION public.ghostchat_match_chunks(
  query_embedding extensions.vector(384),
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
    AND NOT EXISTS (
      SELECT 1 FROM public.ghostchat_documents d
      WHERE d.id = c.document_id AND d.deleted_at IS NOT NULL
    )
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

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
      AND NOT EXISTS (
        SELECT 1 FROM public.ghostchat_documents d
        WHERE d.id = c.document_id AND d.deleted_at IS NOT NULL
      )
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
      AND NOT EXISTS (
        SELECT 1 FROM public.ghostchat_documents d
        WHERE d.id = c.document_id AND d.deleted_at IS NOT NULL
      )
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
