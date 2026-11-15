-- Discord inbox + DM live chat: per-agent active chat, DM channel, idle-close warning.
ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS discord_dm_channel_id text,
  ADD COLUMN IF NOT EXISTS discord_dm_header_id text,
  ADD COLUMN IF NOT EXISTS discord_dm_kind text,
  ADD COLUMN IF NOT EXISTS close_warned_at timestamptz;

CREATE INDEX IF NOT EXISTS ghostchat_live_conv_discord_dm_idx
  ON public.ghostchat_live_conversations (discord_dm_channel_id);

CREATE TABLE IF NOT EXISTS public.ghostchat_discord_agent_state (
  discord_user_id text PRIMARY KEY,
  owner_id uuid REFERENCES public.ghostchat_owners(id) ON DELETE CASCADE,
  active_conversation_id uuid REFERENCES public.ghostchat_live_conversations(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
