-- Stage D: weighted message credits, auto-recharge settings, encrypted owner API keys.
-- ghostchat_ tables only.

CREATE OR REPLACE FUNCTION public.ghostchat_increment_messages_by(p_site uuid, p_limit integer, p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
  d integer;
BEGIN
  d := GREATEST(1, COALESCE(p_delta, 1));
  UPDATE public.ghostchat_sites
  SET
    messages_this_period = messages_this_period + d,
    usage_alert_level = CASE
      WHEN p_limit > 0 AND (messages_this_period + d)::numeric / p_limit >= 1 THEN 100
      WHEN p_limit > 0 AND (messages_this_period + d)::numeric / p_limit >= 0.8 THEN GREATEST(usage_alert_level, 80)
      ELSE usage_alert_level
    END,
    updated_at = now()
  WHERE id = p_site
  RETURNING messages_this_period INTO n;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghostchat_use_credits(p_owner uuid, p_n integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ghostchat_owners
  SET message_credits = GREATEST(0, message_credits - GREATEST(0, COALESCE(p_n, 1))), updated_at = now()
  WHERE id = p_owner
  RETURNING message_credits;
$$;

REVOKE ALL ON FUNCTION public.ghostchat_increment_messages_by(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_use_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ghostchat_increment_messages_by(uuid, integer, integer) TO service_role;
GRANT ALL ON FUNCTION public.ghostchat_use_credits(uuid, integer) TO service_role;

ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS auto_recharge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_recharge_pack integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS auto_recharge_cap_gbp integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS auto_recharge_month text,
  ADD COLUMN IF NOT EXISTS auto_recharge_spent_gbp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_interval text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ghostchat_owners_auto_recharge_pack_chk'
  ) THEN
    ALTER TABLE public.ghostchat_owners
      ADD CONSTRAINT ghostchat_owners_auto_recharge_pack_chk
      CHECK (auto_recharge_pack IN (1000, 5000));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ghostchat_owner_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  provider text NOT NULL
    CHECK (provider IN ('openrouter', 'openai', 'gemini', 'grok')),
  ciphertext text NOT NULL,
  key_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

CREATE INDEX IF NOT EXISTS ghostchat_owner_keys_owner_idx
  ON public.ghostchat_owner_keys (owner_id);

ALTER TABLE public.ghostchat_owner_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_owner_keys FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_owner_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.ghostchat_auto_recharge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  pack integer NOT NULL,
  price_gbp integer NOT NULL,
  status text NOT NULL DEFAULT 'needed'
    CHECK (status IN ('needed', 'prompted', 'granted', 'skipped', 'error')),
  reason text,
  month text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_auto_recharge_events_owner_idx
  ON public.ghostchat_auto_recharge_events (owner_id, created_at DESC);

ALTER TABLE public.ghostchat_auto_recharge_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_auto_recharge_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_auto_recharge_events TO service_role;

COMMENT ON TABLE public.ghostchat_owner_keys IS
  'Owner BYOK API keys, stored encrypted. Service role only; never expose ciphertext to the client.';
