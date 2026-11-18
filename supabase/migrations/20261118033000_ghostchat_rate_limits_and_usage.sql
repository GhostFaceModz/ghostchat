-- Persistent rate limits, daily caps, atomic message increments, and short-lived auth tickets.
-- Service-role only (RLS on, no policies for anon/authenticated).

CREATE TABLE IF NOT EXISTS public.ghostchat_rate_limits (
  bucket_key text NOT NULL,
  window_id bigint NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_id)
);
CREATE INDEX IF NOT EXISTS ghostchat_rate_limits_updated_idx ON public.ghostchat_rate_limits (updated_at);
ALTER TABLE public.ghostchat_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ghostchat_daily_caps (
  site_id uuid NOT NULL REFERENCES public.ghostchat_sites(id) ON DELETE CASCADE,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, day)
);
ALTER TABLE public.ghostchat_daily_caps ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ghostchat_auth_tickets (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  remember boolean NOT NULL DEFAULT true,
  return_path text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ghostchat_auth_tickets_expires_idx ON public.ghostchat_auth_tickets (expires_at);
ALTER TABLE public.ghostchat_auth_tickets ENABLE ROW LEVEL SECURITY;

-- Atomic sliding-window style counter: increment this window, return new count.
CREATE OR REPLACE FUNCTION public.ghostchat_rate_hit(p_key text, p_window_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.ghostchat_rate_limits (bucket_key, window_id, count, updated_at)
  VALUES (p_key, p_window_id, 1, now())
  ON CONFLICT (bucket_key, window_id)
  DO UPDATE SET count = public.ghostchat_rate_limits.count + 1, updated_at = now()
  RETURNING count INTO n;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghostchat_rate_peek(p_key text, p_window_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT count FROM public.ghostchat_rate_limits WHERE bucket_key = p_key AND window_id = p_window_id), 0);
$$;

CREATE OR REPLACE FUNCTION public.ghostchat_daily_hit(p_site uuid, p_day date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.ghostchat_daily_caps (site_id, day, count, updated_at)
  VALUES (p_site, p_day, 1, now())
  ON CONFLICT (site_id, day)
  DO UPDATE SET count = public.ghostchat_daily_caps.count + 1, updated_at = now()
  RETURNING count INTO n;
  RETURN n;
END;
$$;

-- Atomic monthly message increment; also bumps usage_alert_level when it rises.
CREATE OR REPLACE FUNCTION public.ghostchat_increment_messages(p_site uuid, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
  level smallint;
BEGIN
  UPDATE public.ghostchat_sites
  SET
    messages_this_period = messages_this_period + 1,
    usage_alert_level = CASE
      WHEN p_limit > 0 AND (messages_this_period + 1)::numeric / p_limit >= 1 THEN 100
      WHEN p_limit > 0 AND (messages_this_period + 1)::numeric / p_limit >= 0.8 THEN GREATEST(usage_alert_level, 80)
      ELSE usage_alert_level
    END,
    updated_at = now()
  WHERE id = p_site
  RETURNING messages_this_period, usage_alert_level INTO n, level;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghostchat_increment_leads(p_site uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.ghostchat_sites
  SET leads_this_period = leads_this_period + 1, updated_at = now()
  WHERE id = p_site
  RETURNING leads_this_period INTO n;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.ghostchat_rate_hit(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_rate_peek(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_daily_hit(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_increment_messages(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghostchat_increment_leads(uuid) FROM PUBLIC, anon, authenticated;

-- Keep the Render free instance awake from the existing Supabase project (no new account).
-- /healthz is public; this job has no secret. Re-applying unschedules first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ghostchat_keepwarm') THEN
    PERFORM cron.unschedule('ghostchat_keepwarm');
  END IF;
END $$;
SELECT cron.schedule(
  'ghostchat_keepwarm',
  '*/5 * * * *',
  $cron$SELECT net.http_get(url := 'https://ghostchat.pro/healthz', timeout_milliseconds := 80000)$cron$
);
