-- AI disclosure is optional on every plan and off by default.
-- Sites that still have the old built-in line are cleared so the widget footer stays compact.
ALTER TABLE public.ghostchat_sites
  ALTER COLUMN ai_disclosure SET DEFAULT '';

UPDATE public.ghostchat_sites
  SET ai_disclosure = ''
  WHERE ai_disclosure IS NULL
     OR btrim(ai_disclosure) = 'This chat uses AI.';
