-- Top-up message credits (per account), usage alerts and idempotent credit grants.
ALTER TABLE public.ghostchat_owners ADD COLUMN IF NOT EXISTS message_credits integer NOT NULL DEFAULT 0;
ALTER TABLE public.ghostchat_sites ADD COLUMN IF NOT EXISTS usage_alert_level smallint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.ghostchat_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.ghostchat_owners(id) ON DELETE SET NULL,
  whop_payment_id text NOT NULL UNIQUE,
  plan_id text,
  credits integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ghostchat_credit_grants ENABLE ROW LEVEL SECURITY;
-- Atomic credit changes (service role only).
CREATE OR REPLACE FUNCTION public.ghostchat_add_credits(p_owner uuid, p_delta integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ghostchat_owners SET message_credits = GREATEST(0, message_credits + p_delta), updated_at = now()
  WHERE id = p_owner RETURNING message_credits;
$$;
CREATE OR REPLACE FUNCTION public.ghostchat_use_credit(p_owner uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE public.ghostchat_owners SET message_credits = message_credits - 1
             WHERE id = p_owner AND message_credits > 0 RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE ALL ON FUNCTION public.ghostchat_add_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_use_credit(uuid) FROM PUBLIC, anon, authenticated;
