/** Owner-pasted Slack incoming webhooks for waiting live-chat alerts. No Slack app. */

const PATH = /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+$/;

export function isSlackIncomingWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw || "").trim());
    return u.protocol === "https:" && u.hostname === "hooks.slack.com" && PATH.test(u.pathname) && !u.search && !u.hash;
  } catch {
    return false;
  }
}

export function normalizeSlackWebhookUrl(raw: unknown): { url: string | null; error?: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { url: null };
  if (!isSlackIncomingWebhookUrl(s)) {
    return { url: null, error: "Paste a Slack incoming webhook URL from hooks.slack.com." };
  }
  return { url: s };
}

export type SlackFetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number }>;

export function slackWaitingText(siteName: string, why?: string): string {
  const reason = why ? ` (${why})` : "";
  return `A visitor is waiting for a human on ${siteName}${reason}. Open the GhostChat live inbox to claim the chat.`;
}

export async function postSlackWaitingAlert(opts: {
  webhookUrl: string;
  siteName: string;
  why?: string;
  fetchImpl?: SlackFetch;
}): Promise<boolean> {
  if (!isSlackIncomingWebhookUrl(opts.webhookUrl)) return false;
  const fetchImpl = opts.fetchImpl || ((url, init) => fetch(url, init));
  const res = await fetchImpl(opts.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: slackWaitingText(opts.siteName, opts.why) }),
  });
  return Boolean(res && res.ok);
}
