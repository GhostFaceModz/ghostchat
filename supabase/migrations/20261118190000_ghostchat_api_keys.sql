-- Hashed owner API keys for the signed search API and MCP endpoint.
-- ghostchat_ tables only.

CREATE TABLE IF NOT EXISTS public.ghostchat_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Search key',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS ghostchat_api_keys_site_idx
  ON public.ghostchat_api_keys (site_id, created_at DESC);

ALTER TABLE public.ghostchat_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_api_keys FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_api_keys TO service_role;

COMMENT ON TABLE public.ghostchat_api_keys IS
  'Hashed API keys an owner can generate to search a site knowledge base via /api/v1/search.';
