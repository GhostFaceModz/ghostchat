-- How links in the widget (recommendation cards, source links, Open buttons) open.
-- same_tab (default): the site's own pages open in the current tab / PWA. External links still open in a new tab.
-- new_tab: every link opens in a new tab, which is the previous behaviour.
ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS open_site_links text NOT NULL DEFAULT 'same_tab';
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_open_site_links_check CHECK (open_site_links IN ('same_tab', 'new_tab'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
