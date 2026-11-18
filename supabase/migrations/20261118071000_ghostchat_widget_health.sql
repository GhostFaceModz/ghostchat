-- Stage F2: widget install health (last seen + last page).
-- ghostchat_ tables only.

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS last_widget_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_widget_page text,
  ADD COLUMN IF NOT EXISTS last_install_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_install_check jsonb;
