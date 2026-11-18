-- Stage E: team seats, weekly digests, visitor email channel.
-- ghostchat_ tables only.

ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS digest_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digest_last_week text;

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS email_channel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_inbound_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS email_from_name text;

CREATE TABLE IF NOT EXISTS public.ghostchat_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'agent'
    CHECK (role IN ('agent', 'viewer')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked')),
  invite_token_hash text,
  member_id uuid REFERENCES public.ghostchat_owners(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES public.ghostchat_owners(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS ghostchat_team_members_member_idx
  ON public.ghostchat_team_members (member_id);
CREATE INDEX IF NOT EXISTS ghostchat_team_members_token_idx
  ON public.ghostchat_team_members (invite_token_hash);

ALTER TABLE public.ghostchat_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_team_members FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_team_members TO service_role;

CREATE TABLE IF NOT EXISTS public.ghostchat_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  week text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  emailed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, week)
);

CREATE INDEX IF NOT EXISTS ghostchat_digests_owner_idx
  ON public.ghostchat_digests (owner_id, created_at DESC);

ALTER TABLE public.ghostchat_digests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_digests FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_digests TO service_role;

CREATE TABLE IF NOT EXISTS public.ghostchat_email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  visitor_email text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  ticket_id uuid,
  session_id text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_email_threads_site_idx
  ON public.ghostchat_email_threads (site_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.ghostchat_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ghostchat_email_threads(id) ON DELETE CASCADE,
  direction text NOT NULL
    CHECK (direction IN ('in', 'out', 'draft')),
  from_email text,
  to_email text,
  subject text,
  body text NOT NULL DEFAULT '',
  message_id text,
  in_reply_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS ghostchat_email_messages_thread_idx
  ON public.ghostchat_email_messages (thread_id, created_at);

ALTER TABLE public.ghostchat_email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostchat_email_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_email_threads FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.ghostchat_email_messages FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_email_threads TO service_role;
GRANT ALL ON TABLE public.ghostchat_email_messages TO service_role;

COMMENT ON TABLE public.ghostchat_team_members IS
  'Teammates invited to a billing workspace. Service role only.';
COMMENT ON TABLE public.ghostchat_email_threads IS
  'Visitor email-channel threads for Business sites. Service role only.';
