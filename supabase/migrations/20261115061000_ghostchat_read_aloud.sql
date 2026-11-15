-- Per-reply listen button (browser TTS). Separate from voice_enabled (Pro mic + auto-speak).
-- Default on for existing and new sites.

ALTER TABLE public.ghostchat_sites
  ADD COLUMN IF NOT EXISTS read_aloud_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ghostchat_sites.read_aloud_enabled IS
  'When true, the widget shows a speaker button next to each AI reply so visitors can hear it read aloud. Independent of voice_enabled.';
