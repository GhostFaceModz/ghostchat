-- GhostChat v2: OAuth identities, billing fields, training sources, booking/voice/cards.
-- Touches only ghostchat_* objects.

ALTER TABLE public.ghostchat_owners
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS discord_id text,
  ADD COLUMN IF NOT EXISTS google_id text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS whop_membership_id text,
  ADD COLUMN IF NOT EXISTS whop_customer_id text;

ALTER TABLE public.ghostchat_owners
  DROP CONSTRAINT IF EXISTS ghostchat_owners_plan_check;

ALTER TABLE public.ghostchat_owners
  ADD CONSTRAINT ghostchat_owners_plan_check CHECK (plan IN ('free', 'pro', 'business'));

CREATE UNIQUE INDEX IF NOT EXISTS ghostchat_owners_discord_id_idx
  ON public.ghostchat_owners (discord_id)
  WHERE discord_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ghostchat_owners_google_id_idx
  ON public.ghostchat_owners (google_id)
  WHERE google_id IS NOT NULL;

COMMENT ON COLUMN public.ghostchat_owners.plan IS
  'Owner billing plan, synced from Whop and copied onto ghostchat_sites.';

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS booking_url text,
  ADD COLUMN IF NOT EXISTS booking_provider text,
  ADD COLUMN IF NOT EXISTS voice_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversion_cards jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.ghostchat_sites
  DROP CONSTRAINT IF EXISTS ghostchat_sites_booking_provider_check;

ALTER TABLE public.ghostchat_sites
  ADD CONSTRAINT ghostchat_sites_booking_provider_check
  CHECK (booking_provider IS NULL OR booking_provider IN ('cal.com', 'calendly', 'other'));

ALTER TABLE public.ghostchat_documents
  DROP CONSTRAINT IF EXISTS ghostchat_documents_source_type_check;

ALTER TABLE public.ghostchat_documents
  ADD CONSTRAINT ghostchat_documents_source_type_check
  CHECK (source_type IN ('crawl', 'upload', 'paste', 'pdf', 'notion'));

CREATE TABLE IF NOT EXISTS public.ghostchat_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.ghostchat_owners(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  whop_event_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ghostchat_billing_events_whop_event_id_idx
  ON public.ghostchat_billing_events (whop_event_id)
  WHERE whop_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ghostchat_billing_events_owner_idx
  ON public.ghostchat_billing_events (owner_id, created_at DESC);

COMMENT ON TABLE public.ghostchat_billing_events IS
  'GhostChat Whop webhook audit log. Used for idempotency and billing support.';

ALTER TABLE public.ghostchat_billing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ghostchat_billing_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_billing_events TO service_role;

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS chat_provider text,
  ADD COLUMN IF NOT EXISTS chat_model text;

COMMENT ON COLUMN public.ghostchat_sites.chat_provider IS
  'Owner-picked chat provider (grok, openai, openrouter, gemini). Falls back to the default (Grok) if that key is missing.';
COMMENT ON COLUMN public.ghostchat_sites.chat_model IS
  'Owner-picked chat model id for the chosen provider.';
