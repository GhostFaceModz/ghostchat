-- House/admin owners: always Business, never downgraded by billing events.
ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ghostchat_owners.is_admin IS
  'GhostChat house/admin account. Kept on the business plan regardless of Whop events.';
