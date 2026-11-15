-- Remember when a live chat closed, and whether its Discord inbox card was removed.
-- Pending card deletes survive a restart: a sweep removes closed cards older than the owner's delay.
ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS discord_cleared_at timestamptz;

CREATE INDEX IF NOT EXISTS ghostchat_live_conv_closed_clear_idx
  ON public.ghostchat_live_conversations (status, closed_at)
  WHERE status = 'closed' AND discord_cleared_at IS NULL;
