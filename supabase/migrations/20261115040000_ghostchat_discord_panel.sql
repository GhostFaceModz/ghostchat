-- Pinned / moving Discord control panel message for a live conversation.
ALTER TABLE public.ghostchat_live_conversations
  ADD COLUMN IF NOT EXISTS discord_panel_id text;
