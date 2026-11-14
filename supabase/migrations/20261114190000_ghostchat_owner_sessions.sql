-- "Sign out of all devices" and password changes: tokens issued before this time are rejected.
ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
