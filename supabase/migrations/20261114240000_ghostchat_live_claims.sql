-- Claimable Discord support tickets for live chat.
ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS discord_channel_id text,
  ADD COLUMN IF NOT EXISTS discord_message_id text,
  ADD COLUMN IF NOT EXISTS claimed_by_id text,
  ADD COLUMN IF NOT EXISTS claimed_by_name text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS waiting_since timestamptz;
CREATE INDEX IF NOT EXISTS ghostchat_live_conv_discord_msg_idx ON public.ghostchat_live_conversations (discord_message_id);
