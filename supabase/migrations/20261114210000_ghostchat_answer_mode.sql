-- Answer mode: 'helpful' (default) lets the bot handle greetings, small talk, general knowledge and
-- questions about itself; 'strict' answers only from the site's content.
ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS answer_mode text NOT NULL DEFAULT 'helpful',
  ADD COLUMN IF NOT EXISTS reveal_model boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.ghostchat_sites ADD CONSTRAINT ghostchat_sites_answer_mode_check CHECK (answer_mode IN ('helpful','strict'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
