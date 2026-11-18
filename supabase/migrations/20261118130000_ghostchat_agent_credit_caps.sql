-- Stage G10: per-agent monthly cap for dashboard AI (copilot). ghostchat_ tables only.

ALTER TABLE public.ghostchat_team_members
  ADD COLUMN IF NOT EXISTS credit_cap integer,
  ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_period text;

ALTER TABLE public.ghostchat_team_members
  DROP CONSTRAINT IF EXISTS ghostchat_team_members_credit_cap_check;

ALTER TABLE public.ghostchat_team_members
  ADD CONSTRAINT ghostchat_team_members_credit_cap_check
  CHECK (credit_cap IS NULL OR (credit_cap >= 1 AND credit_cap <= 10000));

COMMENT ON COLUMN public.ghostchat_team_members.credit_cap IS
  'Optional monthly cap on dashboard AI (inbox/email copilot) for this teammate. Null means no cap. Does not apply to the visitor widget or the workspace owner.';
