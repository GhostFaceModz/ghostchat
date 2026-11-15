-- Support-thread messages, end-of-chat reviews, and remembered agent display names.
ALTER TABLE public.ghostchat_logs
  ADD COLUMN IF NOT EXISTS thread text NOT NULL DEFAULT 'assistant';
DO $$ BEGIN
  ALTER TABLE public.ghostchat_logs ADD CONSTRAINT ghostchat_logs_thread_check CHECK (thread IN ('assistant', 'support'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.ghostchat_logs SET thread = 'support' WHERE role IN ('agent', 'system') AND thread = 'assistant';
CREATE INDEX IF NOT EXISTS ghostchat_logs_thread_idx ON public.ghostchat_logs (site_id, session_id, thread, created_at);

ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS review_pending boolean NOT NULL DEFAULT false;

ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS agent_display_name text;
