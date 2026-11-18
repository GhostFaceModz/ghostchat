import { randomBytes } from "node:crypto";
import { getDb } from "./supabase.js";
import { canUseEmailChannel } from "./team.js";
import { suggestEmailReply } from "./copilot.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { openTicket } from "./tickets.js";
import type { Site } from "../types.js";
import type { Plan } from "../config.js";
import { config } from "../config.js";

export type InboundEmail = {
  from: string;
  to?: string;
  subject?: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
};

export function newInboundToken(): string {
  return randomBytes(18).toString("base64url");
}

export function inboundAddress(token: string): string {
  return `inbound+${token}@inbound.ghostchat.pro`;
}

export function inboundWebhookUrl(token: string): string {
  return `${config.publicUrl}/api/email/inbound/${token}`;
}

export function parseInbound(body: Record<string, unknown>): InboundEmail | null {
  const from = String(body.from || body.sender || body.From || "").trim();
  const text = String(body.text || body.body || body.plain || body.TextBody || "").trim()
    || stripHtml(String(body.html || body.HtmlBody || ""));
  if (!from || !text) return null;
  const email = extractEmail(from);
  if (!email) return null;
  return {
    from: email,
    to: String(body.to || body.To || body.recipient || "").trim() || undefined,
    subject: String(body.subject || body.Subject || "").trim().slice(0, 200) || undefined,
    text: text.slice(0, 8000),
    html: typeof body.html === "string" ? body.html.slice(0, 20000) : undefined,
    messageId: String(body.messageId || body["message-id"] || body.MessageID || "").trim() || undefined,
    inReplyTo: String(body.inReplyTo || body["in-reply-to"] || body.InReplyTo || "").trim() || undefined,
  };
}

function extractEmail(raw: string): string | null {
  const m = raw.match(/[^\s<]+@[^\s>]+/);
  const e = (m ? m[0] : raw).trim().toLowerCase();
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(e) ? e : null;
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function enableEmailChannel(site: Site): Promise<{ token: string; webhookUrl: string; address: string }> {
  if (!canUseEmailChannel(site.plan as Plan)) {
    const err = new Error("The visitor email channel is a Business feature.");
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  const token = site.email_inbound_token || newInboundToken();
  const { error } = await getDb().from("ghostchat_sites").update({
    email_channel: true,
    email_inbound_token: token,
    updated_at: new Date().toISOString(),
  }).eq("id", site.id);
  if (error) throw error;
  return { token, webhookUrl: inboundWebhookUrl(token), address: inboundAddress(token) };
}

export async function disableEmailChannel(siteId: string): Promise<void> {
  await getDb().from("ghostchat_sites").update({ email_channel: false, updated_at: new Date().toISOString() }).eq("id", siteId);
}

export async function loadSiteByInboundToken(token: string): Promise<Site | null> {
  const t = String(token || "").trim();
  if (!t || t.length < 12) return null;
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("email_inbound_token", t).maybeSingle();
  const site = (data as Site) ?? null;
  if (!site || !site.email_channel) return null;
  if (!canUseEmailChannel(site.plan as Plan)) return null;
  return site;
}

export async function acceptInbound(site: Site, mail: InboundEmail): Promise<{ threadId: string; draft: string; summary: string }> {
  const db = getDb();
  const subject = mail.subject || "Website enquiry";
  const sessionId = `email:${mail.from}`.slice(0, 80);
  let threadId: string | null = null;
  const { data: existing } = await db
    .from("ghostchat_email_threads")
    .select("id, ticket_id, session_id")
    .eq("site_id", site.id)
    .eq("visitor_email", mail.from)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    threadId = existing.id;
    await db.from("ghostchat_email_threads").update({ subject, last_message_at: new Date().toISOString() }).eq("id", threadId);
  } else {
    const ticket = await openTicket(site, sessionId, {
      name: mail.from.split("@")[0],
      email: mail.from,
      subject,
      source: "email",
    }).catch(() => null);
    const { data, error } = await db.from("ghostchat_email_threads").insert({
      site_id: site.id,
      owner_id: site.owner_id,
      visitor_email: mail.from,
      subject,
      status: "open",
      ticket_id: ticket?.id || null,
      session_id: sessionId,
    }).select("id").single();
    if (error || !data) throw error || new Error("Could not open the email thread.");
    threadId = data.id;
  }
  await db.from("ghostchat_email_messages").insert({
    thread_id: threadId,
    direction: "in",
    from_email: mail.from,
    to_email: mail.to || inboundAddress(site.email_inbound_token || ""),
    subject,
    body: mail.text,
    message_id: mail.messageId || null,
    in_reply_to: mail.inReplyTo || null,
  });
  const suggestion = await suggestEmailReply(site, mail.text, subject).catch(() => null);
  const draft = suggestion?.reply || "";
  const summary = suggestion?.summary || "";
  if (draft) {
    await db.from("ghostchat_email_messages").insert({
      thread_id: threadId,
      direction: "draft",
      from_email: inboundAddress(site.email_inbound_token || ""),
      to_email: mail.from,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body: draft,
    });
  }
  return { threadId: threadId!, draft, summary };
}

export async function listThreads(siteId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_email_threads")
    .select("id, visitor_email, subject, status, last_message_at, created_at")
    .eq("site_id", siteId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export async function getThread(siteId: string, threadId: string) {
  const { data: thread } = await getDb().from("ghostchat_email_threads").select("*").eq("id", threadId).eq("site_id", siteId).maybeSingle();
  if (!thread) return null;
  const { data: messages } = await getDb()
    .from("ghostchat_email_messages")
    .select("id, direction, from_email, to_email, subject, body, created_at, sent_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  return { thread, messages: messages || [] };
}

export async function sendThreadReply(site: Site, threadId: string, body: string, agentName?: string): Promise<{ ok: boolean; error?: string }> {
  const packed = await getThread(site.id, threadId);
  if (!packed) return { ok: false, error: "Thread not found." };
  const to = packed.thread.visitor_email as string;
  const subject = String(packed.thread.subject || "Re: your message");
  const lastIn = [...packed.messages].reverse().find((m: { direction: string; }) => m.direction === "in") as { body?: string } | undefined;
  if (!mailerConfigured()) {
    await getDb().from("ghostchat_email_messages").insert({
      thread_id: threadId,
      direction: "draft",
      from_email: inboundAddress(site.email_inbound_token || ""),
      to_email: to,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body,
    });
    return { ok: false, error: "Email sending is not configured, so the reply was saved as a draft. Add a free Resend or AgentMail key to send." };
  }
  const fromName = agentName || site.email_from_name || site.name || "Support";
  const result = await sendMail({
    to,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    text: body,
    fromName,
  });
  if (!result.ok) return { ok: false, error: result.error };
  await getDb().from("ghostchat_email_messages").insert({
    thread_id: threadId,
    direction: "out",
    from_email: inboundAddress(site.email_inbound_token || ""),
    to_email: to,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    body,
    sent_at: new Date().toISOString(),
  });
  await getDb().from("ghostchat_email_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);
  void lastIn;
  return { ok: true };
}
