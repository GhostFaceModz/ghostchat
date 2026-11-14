-- Live human takeover: per-site settings, owner channels (Telegram / Discord), conversations and relay map.
ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS live_chat jsonb NOT NULL DEFAULT '{"enabled":false,"trigger":"ask_or_misses","misses":2,"status":"online","agent_name":null}'::jsonb;

ALTER TABLE public.ghostchat_logs DROP CONSTRAINT IF EXISTS ghostchat_logs_role_check;
ALTER TABLE public.ghostchat_logs ADD CONSTRAINT ghostchat_logs_role_check CHECK (role IN ('user', 'assistant', 'agent', 'system'));
ALTER TABLE public.ghostchat_logs ADD COLUMN IF NOT EXISTS agent_name text;

CREATE TABLE IF NOT EXISTS public.ghostchat_live_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('telegram', 'discord')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error')),
  link_code text UNIQUE,
  link_expires_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc text,               -- owner's own Telegram bot token, AES-256-GCM encrypted; never returned to clients
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind)
);

CREATE TABLE IF NOT EXISTS public.ghostchat_live_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'human', 'bot', 'closed')),
  reason text,
  agent_name text,
  page_url text,
  telegram_chat_id text,
  telegram_thread_id bigint,
  discord_thread_id text,
  last_visitor_at timestamptz,
  last_agent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, session_id)
);
CREATE INDEX IF NOT EXISTS ghostchat_live_conv_owner_idx ON public.ghostchat_live_conversations (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ghostchat_live_conv_discord_idx ON public.ghostchat_live_conversations (discord_thread_id);

CREATE TABLE IF NOT EXISTS public.ghostchat_live_relay (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.ghostchat_live_conversations(id) ON DELETE CASCADE,
  channel text NOT NULL,
  ext_chat text NOT NULL,
  ext_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ghostchat_live_relay_lookup ON public.ghostchat_live_relay (channel, ext_chat, ext_message);

ALTER TABLE public.ghostchat_live_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_live_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_live_relay ENABLE ROW LEVEL SECURITY;
