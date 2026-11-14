-- Answer extras the owner controls: source links under answers (0, 1 or 3) and follow-up suggestion chips (0-3).
-- Also the "Site search tools" (JSON search endpoint / catalogue feed the bot can call) and crawl scope options.
ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS max_sources smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_suggestions smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS search_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS crawl_scope jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_max_sources_check CHECK (max_sources IN (0,1,3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_max_suggestions_check CHECK (max_suggestions BETWEEN 0 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
