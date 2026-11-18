-- Owner-pasted Plausible domain and/or GA4 measurement ID for widget events.
alter table public.ghostchat_sites
  add column if not exists plausible_domain text,
  add column if not exists ga4_id text;
