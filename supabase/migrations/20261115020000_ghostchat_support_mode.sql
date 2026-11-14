-- GhostChat support assistant: bot mode, support settings, tickets and satisfaction ratings.
ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS bot_mode text NOT NULL DEFAULT 'assistant',
  ADD COLUMN IF NOT EXISTS support jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_bot_mode_check CHECK (bot_mode IN ('assistant','support','sales','recommendations'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ghostchat_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  session_id text,
  number integer,
  subject text NOT NULL DEFAULT 'Support request',
  name text,
  email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','solved')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  transcript text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  solved_at timestamptz
);
CREATE INDEX IF NOT EXISTS ghostchat_tickets_site_idx ON public.ghostchat_tickets (site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ghostchat_tickets_session_idx ON public.ghostchat_tickets (site_id, session_id);
ALTER TABLE public.ghostchat_tickets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ghostchat_tickets IS 'GhostChat support tickets created by the support assistant. Server-only.';

CREATE TABLE IF NOT EXISTS public.ghostchat_csat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  ticket_id uuid REFERENCES public.ghostchat_tickets(id) ON DELETE SET NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, session_id)
);
ALTER TABLE public.ghostchat_csat ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ghostchat_csat IS 'GhostChat end-of-chat satisfaction ratings (1-5). Server-only.';
