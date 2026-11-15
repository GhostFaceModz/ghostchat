/**
 * Claimable Discord support tickets. GhostChat posts an embed with action buttons in the owner's channel;
 * GhostBot forwards button clicks (custom_id "gcl:<action>:<conversationId>") here, HMAC-signed.
 * The first claimer wins atomically (conditional UPDATE), a thread is opened from the embed and the claimer added.
 * A pinned control panel is kept in the thread so End chat and the other actions stay enabled while the chat is live.
 */
import { getDb } from "./supabase.js";
import { config } from "../config.js";
import { addLog, getConversationById, liveSettings, sanitizeAgentName, transcript, updateConversation, type Conversation } from "./live.js";
import { agentReply, endLiveChat } from "./handoff.js";
import { supportSettings } from "./modes.js";
import { openTicket } from "./tickets.js";
import { discord } from "./relay.js";
import type { Site } from "../types.js";

export const GCL = "gcl:";
const VIOLET = 0x8b5cf6, GREEN = 0x10b981, GREY = 0x6b7280, AMBER = 0xf59e0b;
const MANAGE = (1n << 3n) | (1n << 5n) | (1n << 13n) | (1n << 34n); // Administrator, Manage Server, Manage Messages, Manage Threads
const ACTIONS = "claim|unclaim|transfer|transferto|back|close|transcript|ticket|resolve|qreply";
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export type ClaimState = "open" | "claimed" | "back" | "closed" | "timeout";
export type Line = { role: string; message: string; agent_name?: string | null; lang?: string | null };
export type ClaimViewOpts = {
  quickReplies?: string[];
  hasTicket?: boolean;
  rating?: number | null;
  comment?: string | null;
};

export function supportName(displayName: string): string {
  return sanitizeAgentName(displayName, "Team");
}

export function claimStateFor(conv: Pick<Conversation, "status" | "claimed_by_id">, fallback?: ClaimState): ClaimState {
  if (fallback) return fallback;
  if (conv.status === "closed") return "closed";
  if (conv.status === "waiting") return "open";
  if (conv.status === "human") return "claimed";
  if (conv.status === "bot") return conv.claimed_by_id ? "claimed" : "back";
  return "open";
}

export function languageLabel(code?: string | null): string {
  const raw = String(code || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!raw) return "";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(raw);
    return name ? (name[0].toUpperCase() + name.slice(1)) : raw;
  } catch {
    return raw;
  }
}

export function conversationLanguage(lines: Line[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const label = languageLabel(lines[i].lang);
    if (label) return label;
  }
  return null;
}

export function conversationStart(lines: Line[], n = 4): string {
  const start = lines.filter((l) => l.role === "user" || l.role === "assistant" || l.role === "agent").slice(0, n);
  if (!start.length) return "—";
  return start.map((l) => `${l.role === "user" ? "👤" : l.role === "agent" ? "🧑" : "🤖"} ${clip(l.message.replace(/\s+/g, " "), 160)}`).join("\n");
}

/** Short extract of the AI's last reply, used when a dedicated summary isn't stored. */
export function aiSummary(lines: Line[]): string | null {
  const last = [...lines].reverse().find((l) => l.role === "assistant" && String(l.message || "").trim());
  if (!last) return null;
  return clip(last.message.replace(/\s+/g, " "), 400);
}

export function inboxUrl(siteId: string, sessionId: string): string {
  return `${config.publicUrl}/dashboard?inbox=${encodeURIComponent(siteId)}:${encodeURIComponent(sessionId)}`;
}

export function agentQuickReplies(site: Pick<Site, "support">): string[] {
  const s = supportSettings(site);
  const canned = (s.canned || []).map((c) => c.text).filter(Boolean);
  if (canned.length) return canned.slice(0, 25);
  return (s.quick_replies || []).filter(Boolean).slice(0, 6);
}

export function claimEmbed(
  site: { name: string; id?: string },
  conv: Pick<Conversation, "session_id" | "reason" | "page_url" | "claimed_by_id" | "review_pending">,
  lines: Line[],
  state: ClaimState,
  by?: string | null,
  opts: ClaimViewOpts = {},
) {
  const question = [...lines].reverse().find((l) => l.role === "user")?.message || "(no message yet)";
  const lang = conversationLanguage(lines);
  const summary = aiSummary(lines);
  const start = conversationStart(lines);
  const claimedBy = by || conv.claimed_by_id;
  const status = {
    open: "🟡 **Waiting for a team member** — press **Accept / Claim** to take it.",
    claimed: `🟢 **Claimed by ${claimedBy ? `<@${claimedBy}>` : "a team member"}** — reply in the thread.`,
    back: `🤖 Handed back to the AI${claimedBy ? ` by <@${claimedBy}>` : ""}. Claim to jump back in.`,
    closed: `✅ **Chat ended**${claimedBy ? ` by <@${claimedBy}>` : ""}. The visitor was asked to leave a review.`,
    timeout: "⏱️ Nobody claimed it in time — the visitor was handed back.",
  }[state];
  const why = conv.reason === "asked" ? "Asked for a human" : conv.reason === "misses" ? "Bot couldn't answer" : "Taken over";
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Visitor asked", value: clip(question, 1000) },
    { name: "Page", value: clip(conv.page_url || "—", 200), inline: true },
    { name: "Language", value: lang || "Unknown", inline: true },
    { name: "Why", value: why, inline: true },
    { name: "Start of the conversation", value: clip(start, 1000) },
  ];
  if (summary) fields.push({ name: "AI summary", value: clip(summary, 1000) });
  if (lines.length > 4) {
    const recent = lines.slice(-4).map((l) => `${l.role === "user" ? "👤" : l.role === "agent" ? "🧑" : l.role === "system" ? "•" : "🤖"} ${clip(l.message.replace(/\s+/g, " "), 160)}`).join("\n");
    fields.push({ name: "Latest messages", value: clip(recent, 1000) });
  }
  if (state === "closed" || state === "timeout") {
    if (opts.rating) {
      const stars = "★".repeat(opts.rating) + "☆".repeat(5 - opts.rating);
      fields.push({ name: "Visitor rating", value: clip(`${stars} (${opts.rating}/5)${opts.comment ? `\n${opts.comment}` : ""}`, 1000) });
    } else if (conv.review_pending) {
      fields.push({ name: "Visitor rating", value: "Waiting for the visitor's review." });
    }
  }
  return {
    title: `💬 Live chat · ${clip(site.name, 80)}`,
    description: status,
    color: state === "claimed" ? GREEN : state === "open" ? VIOLET : state === "timeout" ? AMBER : GREY,
    fields,
    footer: { text: `Visitor ${conv.session_id.slice(-6)} · GhostChat` },
    timestamp: new Date().toISOString(),
  };
}

export function claimComponents(convId: string, state: ClaimState, opts: ClaimViewOpts = {}) {
  const ended = state === "closed" || state === "timeout";
  const btn = (action: string, label: string, style: number, emoji?: string) => ({
    type: 2,
    style,
    label,
    custom_id: `${GCL}${action}:${convId}`,
    disabled: ended,
    ...(emoji ? { emoji: { name: emoji } } : {}),
  });
  const rows: Array<{ type: 1; components: Array<Record<string, unknown>> }> = [];
  if (state === "open" || state === "back") {
    rows.push({ type: 1, components: [btn("claim", "Accept / Claim", 3, "🙋"), btn("close", "End chat", 4)] });
    rows.push({ type: 1, components: [btn("transcript", "View transcript", 2, "📄"), btn("ticket", "Create ticket", 2, "🎫")] });
  } else if (state === "claimed") {
    rows.push({ type: 1, components: [btn("close", "End chat", 4), btn("back", "Hand back to AI", 1, "🤖"), btn("transfer", "Transfer", 2, "🔁"), btn("unclaim", "Unclaim", 2)] });
    rows.push({ type: 1, components: [btn("transcript", "View transcript", 2, "📄"), opts.hasTicket ? btn("resolve", "Mark resolved", 3, "✅") : btn("ticket", "Create ticket", 2, "🎫"), ...(opts.hasTicket ? [btn("ticket", "Create ticket", 2, "🎫")] : [])].slice(0, 5) });
    const replies = (opts.quickReplies || []).filter(Boolean).slice(0, 25);
    if (replies.length) {
      rows.push({
        type: 1,
        components: [{
          type: 3,
          custom_id: `${GCL}qreply:${convId}`,
          placeholder: "Send a quick reply…",
          disabled: ended,
          min_values: 1,
          max_values: 1,
          options: replies.map((text, i) => ({ label: clip(text, 100), value: String(i), description: clip(text, 100) })),
        }],
      });
    }
  } else {
    // Closed or timed out: keep the layout visible but unusable so the outcome is clear.
    rows.push({ type: 1, components: [btn("close", "End chat", 4), btn("back", "Hand back to AI", 1, "🤖"), btn("transcript", "View transcript", 2, "📄")] });
  }
  return rows;
}

/** True if any button or select in the payload is disabled. Live chats must not return true. */
export function anyComponentDisabled(rows: ReturnType<typeof claimComponents>): boolean {
  return rows.some((row) => row.components.some((c) => Boolean((c as { disabled?: boolean }).disabled)));
}

export function componentActions(rows: ReturnType<typeof claimComponents>): string[] {
  return rows.flatMap((row) => row.components.map((c) => {
    const id = String((c as { custom_id?: string }).custom_id || "");
    return id.split(":")[1] || "";
  })).filter(Boolean);
}

export function parseCustomId(id: string): { action: string; convId: string } | null {
  const m = new RegExp(`^gcl:(${ACTIONS}):([0-9a-f-]{36})$`).exec(String(id || ""));
  return m ? { action: m[1], convId: m[2] } : null;
}

export function canManage(permissions: string | undefined, userId: string, conv: Pick<Conversation, "claimed_by_id">): boolean {
  if (conv.claimed_by_id && conv.claimed_by_id === userId) return true;
  try { return (BigInt(permissions || "0") & MANAGE) !== 0n; } catch { return false; }
}

const eph = (content: string, extra?: Record<string, unknown>) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] }, ...extra } });

async function siteOf(conv: Conversation): Promise<Site | null> {
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", conv.site_id).maybeSingle();
  return (data as Site) ?? null;
}

async function ticketInfo(siteId: string, sessionId: string): Promise<{ hasTicket: boolean; rating: number | null; comment: string | null }> {
  const { data: tickets } = await getDb().from("ghostchat_tickets").select("id, rating").eq("site_id", siteId).eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1);
  const ticket = (tickets || [])[0] as { id: string; rating: number | null } | undefined;
  const { data: csatRows } = await getDb().from("ghostchat_csat").select("rating, comment").eq("site_id", siteId).eq("session_id", sessionId).limit(1);
  const csat = (csatRows || [])[0] as { rating: number; comment: string | null } | undefined;
  return { hasTicket: Boolean(ticket), rating: csat?.rating ?? ticket?.rating ?? null, comment: csat?.comment ?? null };
}

async function viewFor(site: Site, conv: Conversation, state: ClaimState, by?: string | null) {
  const lines = await transcript(site.id, conv.session_id, 50);
  const info = await ticketInfo(site.id, conv.session_id);
  const opts: ClaimViewOpts = { quickReplies: agentQuickReplies(site), hasTicket: info.hasTicket, rating: info.rating, comment: info.comment };
  return {
    embeds: [claimEmbed(site, conv, lines, state, by, opts)],
    components: claimComponents(conv.id, state, opts),
    allowed_mentions: { parse: [] as string[] },
    opts,
    lines,
  };
}

/** Post the claimable embed for a new handoff. */
export async function postClaimMessage(site: Site, conv: Conversation, channelId: string): Promise<void> {
  const view = await viewFor(site, conv, "open");
  const msg = await discord<{ id: string }>("POST", `/channels/${channelId}/messages`, {
    embeds: view.embeds, components: view.components, allowed_mentions: { parse: [] },
  });
  await updateConversation(conv.id, { discord_channel_id: channelId, discord_message_id: msg.id, discord_thread_id: null, discord_panel_id: null, claimed_by_id: null, claimed_by_name: null });
}

async function patchMessage(channelId: string, messageId: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    await discord("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
    return true;
  } catch (e) {
    console.error("claim edit:", (e as Error).message);
    return false;
  }
}

async function upsertThreadPanel(conv: Conversation, view: { embeds: unknown[]; components: unknown[] }, moveToBottom: boolean): Promise<void> {
  const threadId = conv.discord_thread_id;
  if (!threadId) return;
  const payload = {
    content: "🎛️ **Chat controls** — these stay available until the chat ends.",
    embeds: view.embeds,
    components: view.components,
    allowed_mentions: { parse: [] },
  };
  if (conv.discord_panel_id && moveToBottom) {
    await discord("DELETE", `/channels/${threadId}/messages/${conv.discord_panel_id}`).catch(() => {});
    conv.discord_panel_id = null;
  }
  if (conv.discord_panel_id) {
    const ok = await patchMessage(threadId, conv.discord_panel_id, payload);
    if (ok) return;
    conv.discord_panel_id = null;
  }
  try {
    const msg = await discord<{ id: string }>("POST", `/channels/${threadId}/messages`, payload);
    conv.discord_panel_id = msg.id;
    await updateConversation(conv.id, { discord_panel_id: msg.id });
    await discord("PUT", `/channels/${threadId}/pins/${msg.id}`).catch(() => {});
  } catch (e) {
    console.error("claim panel:", (e as Error).message);
  }
}

async function editClaimMessage(conv: Conversation, state: ClaimState, by?: string | null, opts?: { movePanel?: boolean }): Promise<void> {
  const site = await siteOf(conv);
  if (!site) return;
  const view = await viewFor(site, conv, state, by);
  if (conv.discord_channel_id && conv.discord_message_id) {
    await patchMessage(conv.discord_channel_id, conv.discord_message_id, { embeds: view.embeds, components: view.components, allowed_mentions: { parse: [] } });
  }
  const ended = state === "closed" || state === "timeout";
  await upsertThreadPanel(conv, view, Boolean(opts?.movePanel) && !ended);
}

/** Re-apply enabled controls after a visitor or agent message so they cannot stay stuck disabled. */
export async function refreshLiveControls(conv: Conversation, state?: ClaimState, by?: string | null): Promise<void> {
  const st = claimStateFor(conv, state);
  if (st === "closed" || st === "timeout") {
    await editClaimMessage(conv, st, by || conv.claimed_by_id, { movePanel: false });
    return;
  }
  await editClaimMessage(conv, st, by || conv.claimed_by_id, { movePanel: true });
}

export async function refreshControlsForSession(siteId: string, sessionId: string): Promise<void> {
  const { data } = await getDb().from("ghostchat_live_conversations").select("*").eq("site_id", siteId).eq("session_id", sessionId).maybeSingle();
  const conv = data as Conversation | null;
  if (!conv || (!conv.discord_message_id && !conv.discord_panel_id)) return;
  await refreshLiveControls(conv, claimStateFor(conv), conv.claimed_by_id);
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
    conv.discord_thread_id = threadId;
    const lines = await transcript(site.id, conv.session_id, 30);
    const text = lines.map((l) => `${l.role === "user" ? "👤 **Visitor:**" : l.role === "agent" ? `🧑 **${l.agent_name || "Team"}:**` : l.role === "system" ? "•" : "🤖 **AI:**"} ${clip(l.message.replace(/\s+/g, " "), 300)}`).join("\n");
    await discord("POST", `/channels/${threadId}/messages`, { content: clip(`${text}\n\nReply here to answer the visitor. Use **End chat** when you're done, or \`!back\` / \`!close\`.`, 1900), allowed_mentions: { parse: [] } });
  }
  await discord("PUT", `/channels/${threadId}/thread-members/${userId}`).catch(() => {});
  if (conv.discord_thread_id) await discord("PATCH", `/channels/${threadId}`, { archived: false, locked: false }).catch(() => {});
  await refreshLiveControls({ ...conv, discord_thread_id: threadId }, "claimed", userId);
}

async function postTranscriptAndArchive(conv: Conversation, by: string): Promise<void> {
  const site = await siteOf(conv);
  if (!site || !conv.discord_thread_id) return;
  const lines = await transcript(site.id, conv.session_id, 200);
  const all = lines.map((l) => `[${l.role === "user" ? "Visitor" : l.role === "agent" ? l.agent_name || "Team" : l.role === "system" ? "•" : "AI"}] ${l.message.replace(/\s+/g, " ")}`).join("\n");
  const chunks: string[] = [];
  for (let i = 0; i < all.length && chunks.length < 5; i += 1800) chunks.push(all.slice(i, i + 1800));
  await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: `📄 **Transcript** (closed by <@${by}>)\n${inboxUrl(site.id, conv.session_id)}`, allowed_mentions: { parse: [] } }).catch(() => {});
  for (const c of chunks) await discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: "```\n" + c.replace(/```/g, "ˋˋˋ") + "\n```", allowed_mentions: { parse: [] } }).catch(() => {});
  await discord("PATCH", `/channels/${conv.discord_thread_id}`, { archived: true, locked: true }).catch(() => {});
}

export type ComponentEvent = {
  custom_id: string; user_id: string; user_name: string; permissions?: string;
  values?: string[]; resolved_names?: Record<string, string>;
};

const bg = (p: Promise<unknown>) => { p.catch((e) => console.error("claim bg:", (e as Error).message)); };

async function formatTranscript(site: Site, conv: Conversation): Promise<string> {
  const lines = await transcript(site.id, conv.session_id, 80);
  const body = lines.map((l) => `${l.role === "user" ? "Visitor" : l.role === "agent" ? l.agent_name || "Team" : l.role === "system" ? "•" : "AI"}: ${l.message.replace(/\s+/g, " ")}`).join("\n") || "(no messages yet)";
  return clip(`📄 **Transcript** · ${site.name} · visitor ${conv.session_id.slice(-6)}\n${inboxUrl(site.id, conv.session_id)}\n\n${body}`, 1800);
}

/** Handle a Claim/Unclaim/Transfer/Hand back/End chat/… click. Returns the Discord interaction response. */
export async function handleClaimComponent(ev: ComponentEvent): Promise<Record<string, unknown>> {
  const parsed = parseCustomId(ev.custom_id);
  if (!parsed) return eph("That button isn't recognised.");
  const conv = await getConversationById(parsed.convId);
  if (!conv) return eph("That chat no longer exists.");
  const site = await siteOf(conv);
  if (!site) return eph("That chat no longer exists.");
  const name = supportName(ev.user_name);
  const respond = async (c: Conversation, state: ClaimState, by?: string | null) => {
    const view = await viewFor(site, c, state, by);
    bg(upsertThreadPanel(c, view, state === "claimed"));
    return { type: 7, data: { embeds: view.embeds, components: view.components, allowed_mentions: { parse: [] } } };
  };

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
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${name} joined the chat`, thread: "support" });
      bg(openThreadFor(won, ev.user_id));
      return respond(won, "claimed", ev.user_id);
    }
    case "unclaim": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph(`Only ${conv.claimed_by_id ? `<@${conv.claimed_by_id}>` : "the claimer"} or a moderator can do that.`);
      const patch = { claimed_by_id: null, claimed_by_name: null, claimed_at: null, status: "waiting" as const, waiting_since: new Date().toISOString() };
      await updateConversation(conv.id, patch);
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${conv.claimed_by_name || "The team member"} stepped away. Waiting for a team member…`, thread: "support" });
      return respond({ ...conv, ...patch }, "open");
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
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${toName} joined the chat`, thread: "support" });
      const next = { ...conv, claimed_by_id: to, claimed_by_name: toName, status: "human" as const };
      bg(openThreadFor(next, to));
      bg(editClaimMessage(next, "claimed", to, { movePanel: true }));
      if (conv.discord_thread_id) bg(discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: `🔁 Transferred to <@${to}> by <@${ev.user_id}>.`, allowed_mentions: { users: [to] } }));
      return { type: 7, data: { content: `🔁 Transferred to <@${to}>.`, components: [], allowed_mentions: { parse: [] } } };
    }
    case "back": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can hand this back.");
      const ended = await endLiveChat(conv, "discord", "handback");
      return respond(ended, "closed", ev.user_id);
    }
    case "close": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can end this chat.");
      const ended = await endLiveChat(conv, "discord", "end");
      bg(postTranscriptAndArchive(ended, ev.user_id));
      return respond(ended, "closed", ev.user_id);
    }
    case "transcript": {
      return eph(await formatTranscript(site, conv));
    }
    case "ticket": {
      if (conv.status === "human" && !canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can create a ticket.");
      const last = [...(await transcript(site.id, conv.session_id, 40))].reverse().find((l) => l.role === "user");
      const ticket = await openTicket(site, conv.session_id, { subject: last?.message || "Live chat", source: "discord", details: { via: "discord", agent: name } });
      if (conv.discord_thread_id) bg(discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: `🎫 Ticket #${ticket.number} created.`, allowed_mentions: { parse: [] } }));
      bg(refreshLiveControls(conv, claimStateFor(conv), conv.claimed_by_id));
      return eph(`🎫 Ticket #${ticket.number} created. Open it in the GhostChat dashboard → Tickets.`);
    }
    case "resolve": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can mark this resolved.");
      const now = new Date().toISOString();
      const { data: existing } = await getDb().from("ghostchat_tickets").select("id, number").eq("site_id", site.id).eq("session_id", conv.session_id).in("status", ["open", "pending"]).order("created_at", { ascending: false }).limit(1);
      const row = (existing || [])[0] as { id: string; number: number } | undefined;
      if (row) {
        await getDb().from("ghostchat_tickets").update({ status: "solved", updated_at: now, solved_at: now }).eq("id", row.id);
        bg(refreshLiveControls(conv, claimStateFor(conv), conv.claimed_by_id));
        return eph(`✅ Ticket #${row.number} marked resolved.`);
      }
      const ticket = await openTicket(site, conv.session_id, { subject: "Live chat", source: "discord", details: { via: "discord", resolved: true } });
      await getDb().from("ghostchat_tickets").update({ status: "solved", updated_at: now, solved_at: now }).eq("id", ticket.id);
      bg(refreshLiveControls(conv, claimStateFor(conv), conv.claimed_by_id));
      return eph(`✅ Ticket #${ticket.number} created and marked resolved.`);
    }
    case "qreply": {
      if (!canManage(ev.permissions, ev.user_id, conv)) return eph("Only the claimer or a moderator can send a quick reply.");
      if (conv.status !== "human" && conv.status !== "waiting") return eph("This chat isn't live any more.");
      const replies = agentQuickReplies(site);
      const idx = Number(ev.values?.[0]);
      const text = Number.isInteger(idx) ? replies[idx] : "";
      if (!text) return eph("That quick reply isn't available any more.");
      await agentReply(conv, text, "discord", name);
      if (conv.discord_thread_id) bg(discord("POST", `/channels/${conv.discord_thread_id}/messages`, { content: clip(`🧑 **${name}:** ${text}`, 1900), allowed_mentions: { parse: [] } }));
      bg(refreshLiveControls({ ...conv, status: "human", agent_name: name }, "claimed", ev.user_id));
      return eph(`Sent to the visitor: ${clip(text, 200)}`);
    }
  }
  return eph("Unknown action.");
}

/** Nobody joined in time: fall back and mark the Discord embed. Returns the fallback used. */
export async function applyTimeout(site: Site, conv: Conversation): Promise<"ai" | "form"> {
  const fallback = liveSettings(site).timeout_fallback;
  await updateConversation(conv.id, { status: "bot" });
  await addLog({
    site_id: site.id, session_id: conv.session_id, role: "system", thread: "support",
    message: fallback === "form"
      ? "Sorry, no one from the team is free right now. Leave your email and we'll get back to you."
      : "Sorry, no one from the team is free right now — I'm back to help in the meantime.",
  });
  bg(editClaimMessage({ ...conv, status: "bot" }, "timeout"));
  return fallback;
}

export { editClaimMessage };
