-- Shared GhostChat settings (active embedding space, etc.) plus per-chunk model labels.
CREATE TABLE IF NOT EXISTS public.ghostchat_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ghostchat_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_settings FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_settings TO service_role;

COMMENT ON TABLE public.ghostchat_settings IS
  'GhostChat internal key/value settings. Service role only.';

ALTER TABLE public.ghostchat_chunks
  ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE public.ghostchat_corrections
  ADD COLUMN IF NOT EXISTS embedding_model text;
