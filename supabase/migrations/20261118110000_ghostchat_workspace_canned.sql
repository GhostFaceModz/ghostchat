-- Stage G7: workspace-level canned replies on the owner account. ghostchat_ tables only.

ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS canned_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.ghostchat_owners.canned_replies IS
  'Workspace canned replies available in the live inbox and ticket replies.';
