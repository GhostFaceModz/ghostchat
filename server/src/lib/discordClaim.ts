/**
 * Claimable Discord support tickets. GhostChat posts an embed with a Claim button in the owner's channel;
 * GhostBot forwards button clicks (custom_id "gcl:<action>:<conversationId>") here, HMAC-signed.
 * The first claimer wins atomically (conditional UPDATE), a thread is opened from the embed and the claimer added.
 */
import { getDb } from "./supabase.js";
import { addLog, getConversationById, liveSettings, transcript, updateConversation, type Conversation } from "./live.js";
import { discord } from "./relay.js";
import type { Site } from "../types.js";

export const GCL = "gcl:";
const VIOLET = 0x8b5cf6, GREEN = 0x10b981, GREY = 0x6b7280, AMBER = 0xf59e0b;
const MANAGE = (1n << 3n) | (1n << 5n) | (1n << 13n) | (1n << 34n); // Administrator, Manage Server, Manage Messages, Manage Threads
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export type ClaimState = "open" | "claimed" | "back" | "closed" | "timeout";
type Line = { role: string; message: string; agent_name?: string | null };

export function supportName(displayName: string): string {
  return `${clip(displayName.trim() || "Team", 28)} (Support)`;
}

export function claimEmbed(site: Pick<Site, "name">, conv: Pick<Conversation, "session_id" | "reason" | "page_url" | "claimed_by_id">, lines: Line[], state: ClaimState, by?: string | null) {
  const question = [...lines].reverse().find((l) => l.role === "user")?.message || "(no message yet)";
  const snippet = lines.slice(-6).map((l) => `${l.role === "user" ? "👤" : l.role === "agent" ? "🧑" : l.role === "system" ? "•" : "🤖"} ${clip(l.message.replace(/\s+/g, " "), 160)}`).join("\n") || "—";
  const status = {
    open: "🟡 **Waiting for a team member** — press Claim to take it.",
    claimed: `🟢 **Claimed by ${by ? `<@${by}>` : "a team member"}** — reply in the thread.`,
    back: `🤖 Handed back to the AI${by ? ` by <@${by}>` : ""}. Claim to jump back in.`,
    closed: `✅ Closed${by ? ` by <@${by}>` : ""}.`,
    timeout: "⏱️ Nobody claimed it in time — the visitor was handed back.",
  }[state];
  return {
    title: `💬 Live chat · ${clip(site.name, 80)}`,
    description: status,
    color: state === "claimed" ? GREEN : state === "open" ? VIOLET : state === "timeout" ? AMBER : GREY,
    fields: [
      { name: "Visitor asked", value: clip(question, 1000) },
      { name: "Recent conversation", value: clip(snippet, 1000) },
      { name: "Site", value: clip(site.name, 100), inline: true },
      { name: "Why", value: conv.reason === "asked" ? "Asked for a human" : conv.reason === "misses" ? "Bot couldn't answer" : "Taken over", inline: true },
      ...(conv.page_url ? [{ name: "Page", value: clip(conv.page_url, 200), inline: false }] : []),
    ],
    footer: { text: `Visitor ${conv.session_id.slice(-6)} · GhostChat` },
    timestamp: new Date().toISOString(),
  };
}

export function claimComponents(convId: string, state: ClaimState) {
  const btn = (action: string, label: string, style: number, emoji?: string) => ({ type: 2, style, label, custom_id: `${GCL}${action}:${convId}`, ...(emoji ? { emoji: { name: emoji } } : {}) });
  if (state === "open" || state === "back") return [{ type: 1, components: [btn("claim", "Claim", 3, "🙋")] }];
  if (state === "claimed") return [{ type: 1, components: [btn("unclaim", "Unclaim", 2), btn("transfer", "Transfer", 2, "🔁"), btn("back", "Hand back to AI", 1, "🤖"), btn("close", "Close", 4, "✅")] }];
  return [];
}

export function parseCustomId(id: string): { action: string; convId: string } | null {
  const m = /^gcl:(claim|unclaim|transfer|transferto|back|close):([0-9a-f-]{36})$/.exec(String(id || ""));
  return m ? { action: m[1], convId: m[2] } : null;
}

export function canManage(permissions: string | undefined, userId: string, conv: Pick<Conversation, "claimed_by_id">): boolean {
  if (conv.claimed_by_id && conv.claimed_by_id === userId) return true;
  try { return (BigInt(permissions || "0") & MANAGE) !== 0n; } catch { return false; }
}

const eph = (content: string) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

async function siteOf(conv: Conversation): Promise<Site | null> {
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", conv.site_id).maybeSingle();
  return (data as Site) ?? null;
}

/** Post the claimable embed for a new handoff. */
export async function postClaimMessage(site: Site, conv: Conversation, channelId: string): Promise<void> {
  const lines = await transcript(site.id, conv.session_id, 50);
  const msg = await discord<{ id: string }>("POST", `/channels/${channelId}/messages`, {
    embeds: [claimEmbed(site, conv, lines, "open")], components: claimComponents(conv.id, "open"), allowed_mentions: { parse: [] },
  });
  await updateConversation(conv.id, { discord_channel_id: channelId, discord_message_id: msg.id, discord_thread_id: null, claimed_by_id: null, claimed_by_name: null });
}

async function editClaimMessage(conv: Conversation, state: ClaimState, by?: string | null): Promise<void> {
  if (!conv.discord_channel_id || !conv.discord_message_id) return;
  const site = await siteOf(conv);
  if (!site) return;
  const lines = await transcript(site.id, conv.session_id, 50);
  await discord("PATCH", `/channels/${conv.discord_channel_id}/messages/${conv.discord_message_id}`, { embeds: [claimEmbed(site, conv, lines, state, by)], components: claimComponents(conv.id, state) }).catch((e) => console.error("claim edit:", (e as Error).message));
}

/** After a claim: open (or reuse) the thread on the embed, add the claimer, post the transcript so far. */
async function openThreadFor(conv: Conversation, userId: string): Promise<void> {
  const site = await siteOf(conv);
  if (!site || !conv.discord_channel_id || !conv.discord_message_id) return;
  let threadId = conv.discord_thread_id;
  if (!threadId) {
    const t = await discord<{ id: string }>("POST", `/channels/${conv.discord_channel_id}/messages/${conv.discord_message_id}/threads`, { name: clip(`💬 ${site.name} · ${conv.session_id.slice(-6)}`, 95), auto_archive_duration: 1440 });
    threadId = t.id;
    await updateConversation(conv.id, { discord_thread_id: threadId });
    const lines = await transcript(site.id, conv.session_id, 30);
    const text = lines.map((l) => `${l.role === "user" ? "👤 **Visitor:**" : l.role === "agent" ? `🧑 **${l.agent_name || "Team"}:**` : l.role === "system" ? "•" : "🤖 **AI:**"} ${clip(l.message.replace(/\s+/g, " "), 300)}`).join("\n");
    await discord("POST", `/channels/${threadId}/messages`, { content: clip(`${text}\n\nReply here to answer the visitor. \`!back\` hands the chat back to the AI.`, 1900), allowed_mentions: { parse: [] } });
  }
  await discord("PUT", `/channels/${threadId}/thread-members/${userId}`).catch(() => {});
  if (conv.discord_thread_id) await discord("PATCH", `/channels/${threadId}`, { archived: false, locked: false }).catch(() => {});
}

async function postTranscriptAndArchive(conv: Conversation, by: string): Promise<void> {
  const site = await siteOf(conv);
  if (!site || !conv.discord_thread_id) return;
  const lines = await transcript(site.id, conv.session_id, 200);
  const all = lines.map((l) => `[${l.role === "user" ? "Visitor" : l.role === "agent" ? l.agent_name || "Team" : l.role === "system" ? "•" : "AI"}] ${l.message.replace(/\s+/g, " ")}`).join("\n");
  const chunks: string[] = [];
  for (let i = 0; i < all.length && chunks.length < 5; i += 1800) chunks.push(all.slice(i, i + 1800));
  await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: `📄 **Transcript** (closed by <@${by}>)`, allowed_mentions: { parse: [] } }).catch(() => {});
  for (const c of chunks) await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: "```\n" + c.replace(/```/g, "ˋˋˋ") + "\n```", allowed_mentions: { parse: [] } }).catch(() => {});
  await discord("PATCH", `/channels/${conv.discord_thread_id}`, { archived: true, locked: true }).catch(() => {});
}

export type ComponentEvent = {
  custom_id: string; user_id: string; user_name: string; permissions?: string;
  values?: string[]; resolved_names?: Record<string, string>;
};

const bg = (p: Promise<unknown>) => { p.catch((e) => console.error("claim bg:", (e as Error).message)); };

/** Handle a Claim/Unclaim/Transfer/Hand back/Close click. Returns the Discord interaction response. */
export async function handleClaimComponent(ev: ComponentEvent): Promise<Record<string, unknown>> {
  const parsed = parseCustomId(ev.custom_id);
  if (!parsed) return eph("That button isn't recognised.");
  const conv = await getConversationById(parsed.convId);
  if (!conv) return eph("That chat no longer exists.");
  const site = await siteOf(conv);
  if (!site) return eph("That chat no longer exists.");
  const name = supportName(ev.user_name);
  const lines = await transcript(site.id, conv.session_id, 50);
  const update = (c: Conversation, state: ClaimState, by?: string | null) => ({ type: 7, data: { embeds: [claimEmbed(site, c, lines, state, by)], components: claimComponents(c.id, state), allowed_mentions: { parse: [] } } });

  switch (parsed.action) {
    case "claim": {
      if (conv.status === "closed") return eph("This chat is closed.");
      const { data } = await getDb().from("ghostchat_live_conversations")
        .update({ claimed_by_id: ev.user_id, claimed_by_name: name, claimed_at: new Date().toISOString(), status: "human", agent_name: name, updated_at: new Date().toISOString() })
        .eq("id", conv.id).is("claimed_by_id", null).in("status", ["waiting", "bot"]).select("*");
      const won = (data || [])[0] as Conversation | undefined;
      if (!won) {
        const now = await getConversationById(conv.id);
        return eph(now?.claimed_by_id ? `Already claimed by ${now.claimed_by_id === ev.user_id ? "you" : `<@${now.claimed_by_id}>`}.` : "This chat can't be claimed right now.");
      }
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${name} joined the chat` });
      bg(openThreadFor(won, ev.user_id));
      return update(won, "claimed", ev.user_id);
    }
    case "unclaim": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph(`Only ${conv.claimed_by_id ? `<@${conv.claimed_by_id}>` : "the claimer"} or a moderator can do that.`);
      const patch = { claimed_by_id: null, claimed_by_name: null, claimed_at: null, status: "waiting" as const, waiting_since: new Date().toISOString() };
      await updateConversation(conv.id, patch);
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${conv.claimed_by_name || "The team member"} stepped away. Waiting for a team member…` });
      return update({ ...conv, ...patch }, "open");
    }
    case "transfer": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can transfer this chat.");
      return { type: 4, data: { flags: 64, content: "Transfer this chat to:", components: [{ type: 1, components: [{ type: 5, custom_id: `${GCL}transferto:${conv.id}`, placeholder: "Pick a team member", min_values: 1, max_values: 1 }] }] } };
    }
    case "transferto": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can transfer this chat.");
      const to = ev.values?.[0];
      if (!to) return eph("Pick someone to transfer to.");
      const toName = supportName(ev.resolved_names?.[to] || "Team");
      await updateConversation(conv.id, { claimed_by_id: to, claimed_by_name: toName, claimed_at: new Date().toISOString(), status: "human", agent_name: toName });
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${toName} joined the chat` });
      const next = { ...conv, claimed_by_id: to, claimed_by_name: toName, status: "human" as const };
      bg(openThreadFor(next, to));
      bg(editClaimMessage(next, "claimed", to));
      if (conv.discord_thread_id) bg(discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: `🔁 Transferred to <@${to}> by <@${ev.user_id}>.`, allowed_mentions: { users: [to] } }));
      return { type: 7, data: { content: `🔁 Transferred to <@${to}>.`, components: [], allowed_mentions: { parse: [] } } };
    }
    case "back": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can hand this back.");
      const patch = { status: "bot" as const, claimed_by_id: null, claimed_by_name: null };
      await updateConversation(conv.id, patch);
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${conv.claimed_by_name || "The team"} handed the chat back to the AI assistant.` });
      return update({ ...conv, ...patch }, "back", ev.user_id);
    }
    case "close": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can close this chat.");
      await updateConversation(conv.id, { status: "closed" });
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: "This live chat has ended. The AI assistant is here if you need anything else." });
      bg(postTranscriptAndArchive(conv, ev.user_id));
      return update({ ...conv, status: "closed" }, "closed", ev.user_id);
    }
  }
  return eph("Unknown action.");
}

/** Nobody joined in time: fall back and mark the Discord embed. Returns the fallback used. */
export async function applyTimeout(site: Site, conv: Conversation): Promise<"ai" | "form"> {
  const fallback = liveSettings(site).timeout_fallback;
  await updateConversation(conv.id, { status: "bot" });
  await addLog({
    site_id: site.id, session_id: conv.session_id, role: "system",
    message: fallback === "form"
      ? "Sorry, no one from the team is free right now. Leave your email and we'll get back to you."
      : "Sorry, no one from the team is free right now — I'm back to help in the meantime.",
  });
  bg(editClaimMessage({ ...conv, status: "bot" }, "timeout"));
  return fallback;
}

export { editClaimMessage };
