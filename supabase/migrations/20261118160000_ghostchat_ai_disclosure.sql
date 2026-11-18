-- Editable AI disclosure line shown in the chat widget.
-- Free plans cannot hide it (enforced in the API); Pro/Business may store an empty string.
alter table public.ghostchat_sites
  add column if not exists ai_disclosure text not null default 'This chat uses AI.';
