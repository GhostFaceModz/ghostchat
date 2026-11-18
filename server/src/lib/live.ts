/**
 * Live human takeover. A conversation (site + visitor session) is "bot" by default; it becomes "waiting"
 * when a handoff triggers and "human" once someone replies. While waiting/human the AI stays silent.
 * Owners reply from the dashboard Inbox, their linked Telegram chat, or Discord (inbox card + DMs).
 */
import crypto from "node:crypto";
import { topicTagsFromText } from "./topicTags.js";
import { getDb } from "./supabase.js";
import { HUMAN_REQUEST } from "./guardrails.js";
import type { Site } from "../types.js";

export type LiveSettings = {
  enabled: boolean;
  trigger: "ask_or_misses" | "ask" | "misses" | "never";
  misses: number;
  status: "online" | "away";
  agent_name: string | null;
  /** Minutes a handoff may wait for someone to claim/answer before falling back. */
  claim_timeout_min: number;
  /** What happens when nobody joins in time: the AI carries on, or the visitor gets the email form. */
  timeout_fallback: "ai" | "form";
  /** Minutes of silence (either side) after a claim before the chat auto-closes. */
  idle_timeout_min: number;
  /** Remove the inbox card (and any fallback thread) from the Discord support channel after a chat closes. */
  clear_closed_discord: boolean;
  /** Seconds to wait after close before removing the card, so a rating can land first. */
  clear_closed_discord_sec: number;
};
export type LiveStatus = "waiting" | "human" | "bot" | "closed";
export type Conversation = {
  id: string; site_id: string; owner_id: string; session_id: string; status: LiveStatus;
  reason: string | null; agent_name: string | null; page_url: string | null;
  telegram_chat_id: string | null; telegram_thread_id: number | null; discord_thread_id: string | null;
  last_visitor_at: string | null; last_agent_at: string | null; created_at: string; updated_at: string;
  discord_channel_id?: string | null; discord_message_id?: string | null; discord_panel_id?: string | null;
  claimed_by_id?: string | null; claimed_by_name?: string | null; claimed_at?: string | null; waiting_since?: string | null;
  review_pending?: boolean;
  discord_dm_channel_id?: string | null; discord_dm_header_id?: string | null; discord_dm_kind?: string | null;
  close_warned_at?: string | null;
  closed_at?: string | null;
  discord_cleared_at?: string | null;
};

export const LIVE_PLANS = new Set(["pro", "business"]);

export function liveSettings(site: Pick<Site, "live_chat">): LiveSettings {
  const raw = (site.live_chat || {}) as Partial<LiveSettings>;
  const trigger = ["ask_or_misses", "ask", "misses", "never"].includes(String(raw.trigger)) ? (raw.trigger as LiveSettings["trigger"]) : "ask_or_misses";
  return {
    enabled: Boolean(raw.enabled),
    trigger,
    misses: Math.min(5, Math.max(1, Math.round(Number(raw.misses) || 2))),
    status: raw.status === "away" ? "away" : "online",
    agent_name: typeof raw.agent_name === "string" && raw.agent_name.trim() ? raw.agent_name.trim().slice(0, 40) : null,
    claim_timeout_min: Math.min(30, Math.max(1, Math.round(Number(raw.claim_timeout_min) || 5))),
    timeout_fallback: raw.timeout_fallback === "form" ? "form" : "ai",
    idle_timeout_min: Math.min(120, Math.max(3, Math.round(Number(raw.idle_timeout_min) || 15))),
    clear_closed_discord: raw.clear_closed_discord !== false,
    clear_closed_discord_sec: Math.min(600, Math.max(10, Math.round(Number(raw.clear_closed_discord_sec) || 60))),
  };
}

export function clearClosedDiscordSec(settings: Pick<LiveSettings, "clear_closed_discord_sec">): number {
  return Math.min(600, Math.max(10, Math.round(Number(settings.clear_closed_discord_sec) || 60)));
}

/** Closed tickets whose Discord inbox card (and any fallback thread) is due to be removed. */
export function shouldClearClosedDiscord(
  conv: Pick<Conversation, "status" | "closed_at" | "updated_at" | "discord_channel_id" | "discord_message_id" | "discord_thread_id" | "discord_dm_channel_id" | "discord_dm_kind" | "discord_cleared_at">,
  settings: Pick<LiveSettings, "clear_closed_discord" | "clear_closed_discord_sec">,
  now = Date.now(),
): boolean {
  if (!settings.clear_closed_discord) return false;
  if (conv.status !== "closed") return false;
  if (conv.discord_cleared_at) return false;
  const hasCard = Boolean(conv.discord_channel_id && conv.discord_message_id);
  const hasFallback = (conv.discord_dm_kind === "thread" || conv.discord_dm_kind === "private_thread") && Boolean(conv.discord_dm_channel_id);
  const hasLegacyThread = Boolean(conv.discord_thread_id);
  if (!hasCard && !hasFallback && !hasLegacyThread) return false;
  const closed = Date.parse(conv.closed_at || conv.updated_at);
  if (!Number.isFinite(closed)) return false;
  return now - closed >= clearClosedDiscordSec(settings) * 1000;
}

/** Discord channel targets to delete after a close — never a DM. */
export function closedDiscordCleanupTargets(conv: Pick<Conversation, "discord_channel_id" | "discord_message_id" | "discord_thread_id" | "discord_dm_channel_id" | "discord_dm_kind">): {
  card: { channelId: string; messageId: string } | null;
  threads: string[];
} {
  const threads: string[] = [];
  const add = (id?: string | null) => { if (id && !threads.includes(id)) threads.push(id); };
  if (conv.discord_dm_kind === "thread" || conv.discord_dm_kind === "private_thread") add(conv.discord_dm_channel_id);
  add(conv.discord_thread_id);
  return {
    card: conv.discord_channel_id && conv.discord_message_id
      ? { channelId: conv.discord_channel_id, messageId: conv.discord_message_id }
      : null,
    threads,
  };
}

/** Has a waiting handoff run out of time? (nobody claimed or replied) */
export function handoffTimedOut(conv: Pick<Conversation, "status" | "waiting_since" | "updated_at" | "last_agent_at">, settings: Pick<LiveSettings, "claim_timeout_min">, now = Date.now()): boolean {
  if (conv.status !== "waiting") return false;
  const since = Date.parse(conv.waiting_since || conv.updated_at);
  return Number.isFinite(since) && now - since > settings.claim_timeout_min * 60_000;
}

/** Latest activity from either side (or the claim/update time if nobody has spoken yet). */
export function lastActivityMs(conv: Pick<Conversation, "last_visitor_at" | "last_agent_at" | "claimed_at" | "updated_at" | "created_at">): number {
  const times = [conv.last_visitor_at, conv.last_agent_at, conv.claimed_at, conv.updated_at, conv.created_at]
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : 0;
}

export function idleWarningMin(timeoutMin: number, warningMin = 2): number {
  return Math.min(Math.max(1, warningMin), Math.max(1, timeoutMin - 1));
}

/** For a claimed chat: warn, then close, after idle_timeout_min with no messages from either side. */
export function idleAction(
  conv: Pick<Conversation, "status" | "last_visitor_at" | "last_agent_at" | "claimed_at" | "updated_at" | "created_at" | "close_warned_at">,
  settings: Pick<LiveSettings, "idle_timeout_min">,
  now = Date.now(),
): "warn" | "close" | null {
  if (conv.status !== "human") return null;
  const last = lastActivityMs(conv);
  if (!last) return null;
  const idleMin = (now - last) / 60_000;
  const timeout = settings.idle_timeout_min;
  const warning = idleWarningMin(timeout, 2);
  if (idleMin >= timeout) return "close";
  if (idleMin >= timeout - warning && !conv.close_warned_at) return "warn";
  return null;
}

export function isLegacyThreadChat(conv: Pick<Conversation, "discord_thread_id" | "discord_dm_channel_id">): boolean {
  return Boolean(conv.discord_thread_id && !conv.discord_dm_channel_id);
}

export function normalizeLiveSettings(input: unknown, current: LiveSettings): LiveSettings {
  const b = (input || {}) as Record<string, unknown>;
  return liveSettings({
    live_chat: {
      enabled: typeof b.enabled === "boolean" ? b.enabled : current.enabled,
      trigger: b.trigger ?? current.trigger,
      misses: b.misses ?? current.misses,
      status: b.status ?? current.status,
      agent_name: typeof b.agent_name === "string" ? b.agent_name : current.agent_name,
      claim_timeout_min: b.claim_timeout_min ?? current.claim_timeout_min,
      timeout_fallback: b.timeout_fallback ?? current.timeout_fallback,
      idle_timeout_min: b.idle_timeout_min ?? current.idle_timeout_min,
      clear_closed_discord: typeof b.clear_closed_discord === "boolean" ? b.clear_closed_discord : current.clear_closed_discord,
      clear_closed_discord_sec: b.clear_closed_discord_sec ?? current.clear_closed_discord_sec,
    },
  } as never);
}

/** Live chat is a Pro feature; Free keeps a locked upsell. */
export function liveAvailable(site: Pick<Site, "plan" | "live_chat">): boolean {
  return LIVE_PLANS.has(site.plan) && liveSettings(site).enabled;
}
/** Available and the owner is online (otherwise the email follow-up form is used). */
export function liveOnline(site: Pick<Site, "plan" | "live_chat">): boolean {
  return liveAvailable(site) && liveSettings(site).status === "online";
}

/** Should this message start a handoff? (visitor asked, or N unanswered questions this session). */
export function shouldStartLive(site: Pick<Site, "plan" | "live_chat">, message: string, unsureCount: number): "asked" | "misses" | null {
  if (!liveOnline(site)) return null;
  const s = liveSettings(site);
  if (s.trigger === "never") return null;
  if ((s.trigger === "ask" || s.trigger === "ask_or_misses") && HUMAN_REQUEST.test(message)) return "asked";
  if ((s.trigger === "misses" || s.trigger === "ask_or_misses") && unsureCount >= s.misses) return "misses";
  return null;
}

export function agentDisplayName(site: Pick<Site, "live_chat" | "name">, ownerName?: string | null): string {
  return liveSettings(site).agent_name || (ownerName || "").split(" ")[0] || `the ${site.name} team`;
}

/** Visitor-facing agent name: trim, strip tags, cap at 32 characters. */
export function sanitizeAgentName(raw: unknown, fallback = ""): string {
  const text = String(raw ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return text || fallback;
}

export type AgentNameSource = "provided" | "remembered" | "discord" | null;
/** Pick a display name: typed name, then a remembered one, then the Discord name when signed in with Discord. */
export function resolveAgentName(input: {
  provided?: string | null;
  remembered?: string | null;
  discordId?: string | null;
  discordName?: string | null;
}): { name: string | null; needsName: boolean; source: AgentNameSource } {
  const provided = sanitizeAgentName(input.provided);
  if (provided) return { name: provided, needsName: false, source: "provided" };
  const remembered = sanitizeAgentName(input.remembered);
  if (remembered) return { name: remembered, needsName: false, source: "remembered" };
  if (input.discordId) {
    const n = sanitizeAgentName(input.discordName);
    if (n) return { name: n, needsName: false, source: "discord" };
  }
  return { name: null, needsName: true, source: null };
}

export function telegramAgentName(config: Record<string, unknown> | null | undefined, userId: string): string | null {
  const names = config?.agent_names;
  if (!names || typeof names !== "object") return null;
  return sanitizeAgentName((names as Record<string, unknown>)[userId]) || null;
}

export function withTelegramAgentName(config: Record<string, unknown>, userId: string, name: string): Record<string, unknown> {
  const prev = (config.agent_names && typeof config.agent_names === "object") ? config.agent_names as Record<string, string> : {};
  return { ...config, agent_names: { ...prev, [userId]: name } };
}

// ---- secrets at rest (owner's own Telegram bot token) ----
function key(): Buffer {
  const base = process.env.LIVE_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (!base) throw new Error("SESSION_SECRET is required to store channel tokens.");
  return crypto.createHash("sha256").update("ghostchat-live:" + base).digest();
}
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}
export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = String(blob).split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
/** Per-channel webhook secret for owners' own Telegram bots (Telegram allows A-Z a-z 0-9 _ -). */
export function channelWebhookSecret(channelId: string): string {
  return crypto.createHmac("sha256", key()).update("tg-webhook:" + channelId).digest("base64url").slice(0, 48);
}
export function newLinkCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (const b of crypto.randomBytes(8)) s += alphabet[b % alphabet.length];
  return "GC-" + s;
}

// ---- typing indicators (in memory) ----
const typing = new Map<string, number>();
export function setTyping(conversationId: string, who: "agent" | "visitor"): void {
  typing.set(`${conversationId}:${who}`, Date.now());
}
export function isTyping(conversationId: string, who: "agent" | "visitor"): boolean {
  const t = typing.get(`${conversationId}:${who}`);
  return Boolean(t && Date.now() - t < 6000);
}

// ---- data ----
export async function getConversation(siteId: string, sessionId: string): Promise<Conversation | null> {
  const { data } = await getDb().from("ghostchat_live_conversations").select("*").eq("site_id", siteId).eq("session_id", sessionId).maybeSingle();
  return (data as Conversation) ?? null;
}
export async function getConversationById(id: string): Promise<Conversation | null> {
  const { data } = await getDb().from("ghostchat_live_conversations").select("*").eq("id", id).maybeSingle();
  return (data as Conversation) ?? null;
}
export async function updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
  await getDb().from("ghostchat_live_conversations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}
export async function countUnsure(siteId: string, sessionId: string): Promise<number> {
  const { count } = await getDb().from("ghostchat_logs").select("id", { count: "exact", head: true })
    .eq("site_id", siteId).eq("session_id", sessionId).eq("role", "assistant").eq("was_unsure", true);
  return count ?? 0;
}
export async function addLog(row: { site_id: string; session_id: string; role: "user" | "assistant" | "agent" | "system"; message: string; agent_name?: string | null; page_url?: string | null; thread?: "assistant" | "support" }): Promise<string | null> {
  const thread = row.thread || (row.role === "agent" || row.role === "system" ? "support" : "assistant");
  const { thread: _ignored, ...rest } = row;
  const topic_tags = row.role === "user" ? topicTagsFromText(row.message) : [];
  const { data } = await getDb().from("ghostchat_logs").insert({ ...rest, thread, was_unsure: false, topic_tags }).select("id").single();
  return (data as { id: string } | null)?.id ?? null;
}
export async function transcript(siteId: string, sessionId: string, limit = 200, thread?: "assistant" | "support") {
  let q = getDb().from("ghostchat_logs").select("id, role, message, agent_name, thread, lang, created_at")
    .eq("site_id", siteId).eq("session_id", sessionId);
  if (thread) q = q.eq("thread", thread);
  const { data } = await q.order("created_at", { ascending: true }).limit(limit);
  return (data || []) as Array<{ id: string; role: string; message: string; agent_name: string | null; thread?: string; lang?: string | null; created_at: string }>;
}
export async function ownerChannels(ownerId: string) {
  const { data } = await getDb().from("ghostchat_live_channels").select("*").eq("owner_id", ownerId);
  return (data || []) as Array<{ id: string; owner_id: string; kind: "telegram" | "discord"; status: string; config: Record<string, unknown>; secret_enc: string | null; link_code: string | null }>;
}
export async function rememberRelay(conversationId: string, channel: string, extChat: string, extMessage: string): Promise<void> {
  await getDb().from("ghostchat_live_relay").insert({ conversation_id: conversationId, channel, ext_chat: extChat, ext_message: extMessage });
}
export async function findRelay(channel: string, extChat: string, extMessage: string): Promise<string | null> {
  const { data } = await getDb().from("ghostchat_live_relay").select("conversation_id").eq("channel", channel).eq("ext_chat", extChat).eq("ext_message", extMessage).limit(1).maybeSingle();
  return (data as { conversation_id: string } | null)?.conversation_id ?? null;
}
