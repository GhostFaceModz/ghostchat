-- Incoming Slack webhook URL for waiting-chat alerts (owner-pasted; no Slack app).
ALTER TABLE public.ghostchat_owners
  ADD COLUMN IF NOT EXISTS slack_webhook_url text;

COMMENT ON COLUMN public.ghostchat_owners.slack_webhook_url IS
  'Optional Slack incoming webhook URL (hooks.slack.com) for waiting live-chat alerts.';
