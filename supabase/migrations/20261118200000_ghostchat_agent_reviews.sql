-- Persist which human agent handled a live chat so end-of-chat ratings can be attributed.
-- claimed_by_* is cleared on close; last_agent_* stays for reviews and first-response stats.

ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS last_agent_id text,
  ADD COLUMN IF NOT EXISTS last_agent_name text;

ALTER TABLE public.ghostchat_csat
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.ghostchat_live_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id text,
  ADD COLUMN IF NOT EXISTS agent_name text,
  ADD COLUMN IF NOT EXISTS handled_by_human boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ghostchat_csat_agent_idx
  ON public.ghostchat_csat (agent_id, created_at DESC)
  WHERE handled_by_human = true;

CREATE INDEX IF NOT EXISTS ghostchat_csat_conversation_idx
  ON public.ghostchat_csat (conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN public.ghostchat_csat.handled_by_human IS 'True when a human agent handled the chat that was rated (used for Team / Agent reviews).';
