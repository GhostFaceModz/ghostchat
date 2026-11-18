import { config } from "../config.js";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  fromName?: string;
};

export function mailerConfigured(): boolean {
  if (config.resendApiKey) return true;
  if (config.agentmailApiKey && (config.agentmailInbox || config.emailFrom)) return true;
  if (config.smtpHost && config.smtpUser && config.smtpPass && config.emailFrom) return true;
  return false;
}

/** Bot-owned inboxes we may use for automated tests. */
export function isBotTestInbox(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e.endsWith("@agentmail.to");
}

export function fromAddress(): string {
  return config.emailFrom || config.agentmailInbox || "GhostChat <noreply@ghostchat.pro>";
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string; skipped?: boolean };

export async function sendMail(mail: OutboundMail): Promise<SendResult> {
  const to = String(mail.to || "").trim();
  if (!to) return { ok: false, error: "A recipient is required." };
  if (!mailerConfigured()) return { ok: false, error: "Email sending is not configured.", skipped: true };

  if (config.resendApiKey) return sendResend(mail, to);
  if (config.agentmailApiKey) return sendAgentMail(mail, to);
  return { ok: false, error: "SMTP sending is not wired yet. Set RESEND_API_KEY or AGENTMAIL_API_KEY (free tiers, no card needed) to send mail.", skipped: true };
}

async function sendResend(mail: OutboundMail, to: string): Promise<SendResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: mail.fromName ? `${mail.fromName} <${stripName(fromAddress())}>` : fromAddress(),
      to: [to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      reply_to: mail.replyTo,
      headers: mail.inReplyTo ? { "In-Reply-To": mail.inReplyTo, References: mail.inReplyTo } : undefined,
    }),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) return { ok: false, error: body.message || "The mail provider rejected that message." };
  return { ok: true, id: body.id };
}

async function sendAgentMail(mail: OutboundMail, to: string): Promise<SendResult> {
  const inbox = config.agentmailInbox || stripName(fromAddress());
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.agentmailApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: [to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      reply_to: mail.replyTo,
    }),
  });
  const body = await res.json().catch(() => ({})) as { message_id?: string; messageId?: string; error?: { message?: string }; message?: string };
  if (!res.ok) return { ok: false, error: body.error?.message || body.message || "AgentMail rejected that message." };
  return { ok: true, id: body.message_id || body.messageId };
}

function stripName(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}
