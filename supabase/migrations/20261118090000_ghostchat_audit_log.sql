-- Stage F4: team audit log. No chat messages or visitor PII.
-- ghostchat_ tables only.

CREATE TABLE IF NOT EXISTS public.ghostchat_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghostchat_audit_log_ws_idx
  ON public.ghostchat_audit_log (workspace_id, created_at DESC);

ALTER TABLE public.ghostchat_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ghostchat_audit_log FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.ghostchat_audit_log TO service_role;

COMMENT ON TABLE public.ghostchat_audit_log IS
  'Workspace activity log for owners and teammates. Stores actions and targets, not chat or visitor content.';
