-- Switch GhostChat embeddings to 384-d so the default local MiniLM model works
-- without an API key. No production chat data is expected yet; the column,
-- index, and match function are dropped and recreated. GhostChat objects only.

DROP INDEX IF EXISTS public.ghostchat_chunks_embedding_idx;

DROP FUNCTION IF EXISTS public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision);

ALTER TABLE public.ghostchat_chunks
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE public.ghostchat_chunks
  ADD COLUMN embedding extensions.vector(384);

CREATE INDEX ghostchat_chunks_embedding_idx
  ON public.ghostchat_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

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
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) IS
  'GhostChat similarity search (384-d, local MiniLM by default), scoped to a single site_id.';

COMMENT ON COLUMN public.ghostchat_chunks.embedding IS
  '384-d embedding. Default provider is local Xenova/all-MiniLM-L6-v2.';

REVOKE ALL ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) FROM anon, authenticated, PUBLIC;
GRANT ALL ON FUNCTION public.ghostchat_match_chunks(extensions.vector, uuid, integer, double precision) TO service_role;
