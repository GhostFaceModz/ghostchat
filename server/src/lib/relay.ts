/** Telegram and Discord delivery for live chat. Tokens come from env (shared bots) or encrypted rows (own bots). */
import crypto from "node:crypto";
import { decryptSecret, ownerChannels, rememberRelay, updateConversation, type Conversation } from "./live.js";
import type { Site } from "../types.js";

export const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "GhostFaceZenBot";
export const DISCORD_APP_ID = process.env.DISCORD_APP_ID || "1558950916823195718";
// View Channel, Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads, Read Message History, Embed Links
export const DISCORD_PERMISSIONS = String(1024 + 2048 + 274877906944 + 34359738368 + 17179869184 + 65536 + 16384);
export const DISCORD_INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=${DISCORD_PERMISSIONS}`;

const sharedTelegramToken = () => process.env.TELEGRAM_BOT_TOKEN || "";
const discordToken = () => process.env.DISCORD_BOT_TOKEN || "";
export const telegramReady = () => Boolean(sharedTelegramToken());
export const discordReady = () => Boolean(discordToken());

async function timed(url: string, init: RequestInit, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// ---- Telegram ----
export async function tg<T = Record<string, unknown>>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  if (!token) throw new Error("Telegram bot token is not configured.");
  const res = await timed(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description || res.status}`);
  return json.result as T;
}
export function telegramTokenFor(channel: { secret_enc: string | null }): string {
  return channel.secret_enc ? decryptSecret(channel.secret_enc) : sharedTelegramToken();
}

// ---- Discord (REST only; the GhostBot gateway relays thread replies back to us) ----
export async function discord<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const token = discordToken();
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured.");
  const res = await timed(`https://discord.com/api/v10${path}`, {
    method,
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return {} as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Discord ${res.status}: ${String(json.message || "error")}`);
  return json as T;
}
export async function discordTextChannels(guildId: string) {
  const list = await discord<Array<{ id: string; name: string; type: number; parent_id: string | null; position: number }>>("GET", `/guilds/${guildId}/channels`);
  return list.filter((c) => c.type === 0).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name }));
}

/** HMAC used by the GhostBot gateway when it relays Discord thread messages to /api/webhooks/discord. */
export function discordRelaySignature(timestamp: string, rawBody: string, secret = process.env.DISCORD_RELAY_SECRET || ""): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}
export function verifyDiscordRelay(timestamp: string | undefined, signature: string | undefined, rawBody: string): boolean {
  const secret = process.env.DISCORD_RELAY_SECRET || "";
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const want = Buffer.from(discordRelaySignature(timestamp, rawBody, secret));
  const got = Buffer.from(signature);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---- notifying the owner's channels ----
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** First notice for a new handoff: opens a Telegram topic/thread message and a Discord thread with the recent transcript. */
export async function announceHandoff(site: Site, conv: Conversation, recent: Array<{ role: string; message: string }>, reason: string): Promise<string[]> {
  const delivered: string[] = [];
  const channels = (await ownerChannels(conv.owner_id)).filter((c) => c.status === "connected");
  const why = reason === "asked" ? "asked for a human" : reason === "misses" ? "the bot couldn't answer" : "you took over";
  const lines = recent.slice(-6).map((m) => `${m.role === "user" ? "👤 Visitor" : m.role === "agent" ? "🧑 You" : "🤖 Bot"}: ${clip(m.message.replace(/\s+/g, " "), 300)}`);
  for (const ch of channels) {
    try {
      if (ch.kind === "telegram") {
        const token = telegramTokenFor(ch);
        const chatId = String(ch.config.chat_id || "");
        if (!chatId || !token) continue;
        let threadId: number | undefined;
        if (ch.config.is_forum) {
          try {
            const topic = await tg<{ message_thread_id: number }>(token, "createForumTopic", { chat_id: chatId, name: clip(`${site.name} · visitor ${conv.session_id.slice(-6)}`, 120) });
            threadId = topic.message_thread_id;
          } catch { /* not an admin with Manage Topics: fall back to reply threading */ }
        }
        const text = `🔔 Live chat on ${site.name} (${why})\n\n${lines.join("\n")}\n\n↩️ Reply to this message to answer the visitor. /back hands the chat back to the AI.`;
        const msg = await tg<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text: clip(text, 3900), ...(threadId ? { message_thread_id: threadId } : {}), disable_web_page_preview: true });
        await rememberRelay(conv.id, "telegram", chatId, String(msg.message_id));
        await updateConversation(conv.id, { telegram_chat_id: chatId, telegram_thread_id: threadId ?? null });
        delivered.push("telegram");
      } else if (ch.kind === "discord" && discordReady()) {
        const channelId = String(ch.config.channel_id || "");
        if (!channelId) continue;
        const thread = await discord<{ id: string }>("POST", `/channels/${channelId}/threads`, { name: clip(`💬 ${site.name} · ${conv.session_id.slice(-6)}`, 95), type: 11, auto_archive_duration: 1440 });
        await discord("POST", `/channels/${thread.id}/messages`, { content: clip(`🔔 **Live chat on ${site.name}** (${why})\n${lines.join("\n")}\n\nReply in this thread to answer the visitor. Type \`!back\` to hand the chat back to the AI.`, 1900), allowed_mentions: { parse: [] } });
        await updateConversation(conv.id, { discord_thread_id: thread.id });
        delivered.push("discord");
      }
    } catch (err) {
      console.error(`live: ${ch.kind} announce failed:`, (err as Error).message);
    }
  }
  return delivered;
}

/** Relay a later visitor message into the existing Telegram thread / Discord thread. */
export async function relayVisitor(site: Site, conv: Conversation, text: string): Promise<void> {
  const channels = (await ownerChannels(conv.owner_id)).filter((c) => c.status === "connected");
  for (const ch of channels) {
    try {
      if (ch.kind === "telegram" && conv.telegram_chat_id) {
        const msg = await tg<{ message_id: number }>(telegramTokenFor(ch), "sendMessage", {
          chat_id: conv.telegram_chat_id, text: clip(`👤 ${site.name} visitor: ${text}`, 3900),
          ...(conv.telegram_thread_id ? { message_thread_id: conv.telegram_thread_id } : {}),
        });
        await rememberRelay(conv.id, "telegram", conv.telegram_chat_id, String(msg.message_id));
      } else if (ch.kind === "discord" && conv.discord_thread_id && discordReady()) {
        await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: clip(`👤 **Visitor:** ${text}`, 1900), allowed_mentions: { parse: [] } });
      }
    } catch (err) {
      console.error(`live: ${ch.kind} relay failed:`, (err as Error).message);
    }
  }
}

/** Tell the other channels what happened (agent replied elsewhere, or chat handed back). */
export async function echoToChannels(conv: Conversation, text: string, except?: string): Promise<void> {
  const channels = (await ownerChannels(conv.owner_id)).filter((c) => c.status === "connected" && c.kind !== except);
  for (const ch of channels) {
    try {
      if (ch.kind === "telegram" && conv.telegram_chat_id) {
        await tg(telegramTokenFor(ch), "sendMessage", { chat_id: conv.telegram_chat_id, text: clip(text, 3900), ...(conv.telegram_thread_id ? { message_thread_id: conv.telegram_thread_id } : {}) });
      } else if (ch.kind === "discord" && conv.discord_thread_id && discordReady()) {
        await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: clip(text, 1900), allowed_mentions: { parse: [] } });
      }
    } catch { /* best effort */ }
  }
}
