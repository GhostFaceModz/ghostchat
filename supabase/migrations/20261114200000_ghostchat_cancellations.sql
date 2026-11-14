-- Cancel-flow log: reason (optional), retention outcome and when access ends.
CREATE TABLE IF NOT EXISTS public.ghostchat_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.ghostchat_owners(id) ON DELETE SET NULL,
  plan text,
  membership_id text,
  reason text,
  details text,
  outcome text NOT NULL,
  access_ends_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ghostchat_cancellations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ghostchat_cancellations IS 'GhostChat subscription cancel flow: reasons and outcomes. Server (service role) only.';
