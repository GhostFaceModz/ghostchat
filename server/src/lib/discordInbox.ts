/**
 * Discord inbox + DM live chat. New handoffs post a compact card in the support channel (no public thread).
 * Claiming opens a DM with the agent (or a public thread under that card if DMs are closed). Each visitor is labelled in
 * the shared DM channel; replies go to the agent's active chat or a Reply modal for a specific visitor.
 */
import { getDb } from "./supabase.js";
import {
  liveSettings, lastActivityMs, updateConversation, getConversationById,
  shouldClearClosedDiscord, closedDiscordCleanupTargets, clearClosedDiscordSec,
  type Conversation,
} from "./live.js";
import { agentReply, endLiveChat } from "./handoff.js";
import { discord } from "./relay.js";
import {
  GCL, aiSummary, closeThreadMessage, conversationLanguage, agentQuickReplies, threadTitle,
  type ClaimState, type Line,
} from "./discordClaim.js";
import type { Site } from "../types.js";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const VIOLET = 0x8b5cf6, GREEN = 0x10b981, GREY = 0x6b7280, AMBER = 0xf59e0b;
const PALETTE = [0x8b5cf6, 0x06b6d4, 0xf59e0b, 0xec4899, 0x10b981, 0x3b82f6, 0xf97316, 0x14b8a6];

export function visitorColor(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (Math.imul(h, 31) + sessionId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function visitorTag(siteName: string, sessionId: string): string {
  return `${clip(siteName, 40)} · ${sessionId.slice(-6)}`;
}

export function inboxStatusText(state: ClaimState, by?: string | null, rating?: number | null): string {
  if (state === "claimed") return `🟢 **Claimed by ${by ? `<@${by}>` : "a team member"}** — I'll open a DM with you.`;
  if (state === "closed" || state === "timeout") {
    if (rating && rating >= 1 && rating <= 5) return `✅ **Closed · ${"★".repeat(rating)}${"☆".repeat(5 - rating)}**`;
    return "✅ **Closed.** The visitor was asked to leave a review.";
  }
  if (state === "back") return "🤖 Handed back. Claim to jump back in — I'll reopen the DM.";
  return "🟡 **Waiting for a team member** — press **Claim** to take it.";
}

function btn(convId: string, action: string, label: string, style: number, disabled = false, emoji?: string) {
  return {
    type: 2, style, label, custom_id: `${GCL}${action}:${convId}`, disabled,
    ...(emoji ? { emoji: { name: emoji } } : {}),
  };
}

/** Compact card in the support channel. No thread is opened from this message. */
export function inboxComponents(convId: string, state: ClaimState, opts: { claimedByName?: string | null } = {}) {
  const ended = state === "closed" || state === "timeout";
  const claimed = state === "claimed";
  const claimLabel = claimed ? clip(`Claimed by ${opts.claimedByName || "a teammate"}`, 80) : "Claim";
  const rows: Array<{ type: 1; components: Array<Record<string, unknown>> }> = [
    {
      type: 1,
      components: [
        btn(convId, "claim", claimLabel, 3, claimed || ended, "🙋"),
        btn(convId, "transcript", "View transcript", 2, false, "📄"),
        btn(convId, "closethread", "Close ticket", 4, ended),
      ],
    },
  ];
  if (claimed && !ended) {
    rows.push({ type: 1, components: [btn(convId, "transfer", "Transfer", 2, false, "🔁")] });
  }
  return rows;
}

export function inboxEmbed(
  site: { name: string; id?: string },
  conv: Pick<Conversation, "session_id" | "reason" | "page_url" | "claimed_by_id" | "review_pending">,
  lines: Line[],
  state: ClaimState,
  by?: string | null,
  opts: { rating?: number | null; comment?: string | null } = {},
) {
  const question = [...lines].reverse().find((l) => l.role === "user")?.message || "(no message yet)";
  const lang = conversationLanguage(lines);
  const summary = aiSummary(lines);
  const recent = lines.slice(-3).map((l) => `${l.role === "user" ? "👤" : l.role === "agent" ? "🧑" : l.role === "system" ? "•" : "🤖"} ${clip(l.message.replace(/\s+/g, " "), 140)}`).join("\n");
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Visitor asked", value: clip(question, 800) },
    { name: "Page", value: clip(conv.page_url || "—", 200), inline: true },
    { name: "Language", value: lang || "Unknown", inline: true },
    { name: "Visitor", value: `\`${conv.session_id.slice(-6)}\``, inline: true },
  ];
  if (summary) fields.push({ name: "AI summary", value: clip(summary, 600) });
  if (recent) fields.push({ name: "Latest messages", value: clip(recent, 800) });
  if (opts.comment && (state === "closed" || state === "timeout")) fields.push({ name: "Review", value: clip(opts.comment, 400) });
  return {
    title: `💬 ${clip(site.name, 80)} · visitor ${conv.session_id.slice(-6)}`,
    description: inboxStatusText(state, by || conv.claimed_by_id, opts.rating ?? null),
    color: state === "claimed" ? GREEN : state === "open" ? VIOLET : state === "timeout" ? AMBER : GREY,
    fields,
    footer: { text: "GhostChat" },
    timestamp: new Date().toISOString(),
  };
}

export function dmControlComponents(convId: string, state: ClaimState, opts: { quickReplies?: string[] } = {}) {
  const ended = state === "closed" || state === "timeout";
  const rows: Array<{ type: 1; components: Array<Record<string, unknown>> }> = [
    { type: 1, components: [btn(convId, "close", "End chat", 4, ended), btn(convId, "back", "Hand back to AI", 1, ended, "🤖"), btn(convId, "transfer", "Transfer", 2, ended, "🔁")] },
    { type: 1, components: [btn(convId, "transcript", "View transcript", 2, false, "📄"), btn(convId, "closethread", "Close ticket", 4, ended)] },
  ];
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
  return rows;
}

export function dmHeaderEmbed(site: { name: string }, conv: Pick<Conversation, "session_id" | "page_url">, active: boolean) {
  return {
    title: `💬 ${visitorTag(site.name, conv.session_id)}`,
    description: active
      ? "This is your **active chat**. Type a reply here, or press **Reply** under a visitor message to answer a specific person."
      : "Press **Switch to this chat** under a message (or below) to make this your active chat, then type to reply.",
    color: visitorColor(conv.session_id),
    fields: [
      { name: "Site", value: clip(site.name, 80), inline: true },
      { name: "Visitor", value: `\`${conv.session_id.slice(-6)}\``, inline: true },
      { name: "Page", value: clip(conv.page_url || "—", 200), inline: true },
    ],
    footer: { text: "GhostChat · DM" },
    timestamp: new Date().toISOString(),
  };
}

export function visitorMessageEmbed(site: { name: string }, sessionId: string, text: string) {
  return {
    title: `👤 ${visitorTag(site.name, sessionId)}`,
    description: clip(text, 1900) || "—",
    color: visitorColor(sessionId),
    footer: { text: "GhostChat visitor" },
    timestamp: new Date().toISOString(),
  };
}

export function visitorMessageComponents(convId: string) {
  return [{
    type: 1,
    components: [
      btn(convId, "replymodal", "Reply", 1, false, "↩️"),
      btn(convId, "switch", "Switch to this chat", 2),
    ],
  }];
}

export function replyModal(convId: string, siteName: string, sessionId: string) {
  return {
    type: 9,
    data: {
      custom_id: `${GCL}replymodal:${convId}`,
      title: clip(`Reply to ${visitorTag(siteName, sessionId)}`, 45),
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: "reply",
          label: "Your message",
          style: 2,
          min_length: 1,
          max_length: 2000,
          required: true,
          placeholder: "Type your reply to this visitor…",
        }],
      }],
    },
  };
}

export function sentConfirmation(siteName: string, sessionId: string, openCount: number): string | null {
  if (openCount < 2) return null;
  return `✅ Sent to **${visitorTag(siteName, sessionId)}**.`;
}

async function siteOf(conv: Conversation): Promise<Site | null> {
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", conv.site_id).maybeSingle();
  return (data as Site) ?? null;
}

export async function setActiveChat(discordUserId: string, conv: Conversation): Promise<void> {
  if (!discordUserId) return;
  await getDb().from("ghostchat_discord_agent_state").upsert({
    discord_user_id: discordUserId,
    owner_id: conv.owner_id,
    active_conversation_id: conv.id,
    updated_at: new Date().toISOString(),
  });
}

export async function getActiveChatId(discordUserId: string): Promise<string | null> {
  if (!discordUserId) return null;
  const { data } = await getDb().from("ghostchat_discord_agent_state").select("active_conversation_id").eq("discord_user_id", discordUserId).maybeSingle();
  return (data as { active_conversation_id: string | null } | null)?.active_conversation_id ?? null;
}

export async function countOpenChats(discordUserId: string): Promise<number> {
  if (!discordUserId) return 0;
  const { count } = await getDb().from("ghostchat_live_conversations").select("id", { count: "exact", head: true })
    .eq("claimed_by_id", discordUserId).in("status", ["human", "waiting"]);
  return count ?? 0;
}

export async function conversationForAgentChannel(channelId: string, authorId: string): Promise<Conversation | null> {
  const { data: rows } = await getDb().from("ghostchat_live_conversations").select("*").eq("discord_dm_channel_id", channelId).order("claimed_at", { ascending: false }).limit(20);
  const list = (rows || []) as Conversation[];
  const open = list.filter((c) => c.status === "human" || c.status === "waiting");
  if (open.length === 1) return open[0];
  if (open.length > 1) {
    const active = await getActiveChatId(authorId);
    return open.find((c) => c.id === active) || open[0];
  }
  const { data: thread } = await getDb().from("ghostchat_live_conversations").select("*").eq("discord_thread_id", channelId).maybeSingle();
  if (thread) return thread as Conversation;
  return list[0] || null;
}

async function postDmHeader(site: Site, conv: Conversation, channelId: string, userId: string, active: boolean): Promise<string | null> {
  const q = agentQuickReplies(site);
  const msg = await discord<{ id: string }>("POST", `/channels/${channelId}/messages`, {
    content: `Hi <@${userId}> — this is **${visitorTag(site.name, conv.session_id)}**.`,
    embeds: [dmHeaderEmbed(site, conv, active)],
    components: dmControlComponents(conv.id, "claimed", { quickReplies: q }),
    allowed_mentions: { users: [userId] },
  });
  await updateConversation(conv.id, { discord_dm_header_id: msg.id, discord_dm_channel_id: channelId } as Partial<Conversation>);
  return msg.id;
}

/** Session kind used when a claimed chat is opened with the agent. "private_thread" is kept for older rows. */
export type AgentSessionMode = "dm" | "thread" | "private_thread";

/** Open a DM with the claimer, or a public thread under the inbox card if DMs are closed. */
export async function openAgentSession(conv: Conversation, userId: string): Promise<{ ok: boolean; mode: AgentSessionMode | null; error?: string }> {
  const site = await siteOf(conv);
  if (!site) return { ok: false, mode: null, error: "That site is no longer available." };
  // Reuse an existing DM / thread for this visitor if we already have one.
  if (conv.discord_dm_channel_id) {
    try {
      await discord("PATCH", `/channels/${conv.discord_dm_channel_id}`, { archived: false, locked: false }).catch(() => {});
      await postDmHeader(site, conv, conv.discord_dm_channel_id, userId, true);
      await setActiveChat(userId, { ...conv, claimed_by_id: userId });
      return { ok: true, mode: (conv.discord_dm_kind as AgentSessionMode) || "dm" };
    } catch (e) {
      console.error("inbox reuse session:", (e as Error).message);
    }
  }
  try {
    const dm = await discord<{ id: string }>("POST", "/users/@me/channels", { recipient_id: userId });
    await postDmHeader(site, { ...conv, discord_dm_channel_id: dm.id }, dm.id, userId, true);
    await updateConversation(conv.id, { discord_dm_channel_id: dm.id, discord_dm_kind: "dm" } as Partial<Conversation>);
    await setActiveChat(userId, { ...conv, claimed_by_id: userId, discord_dm_channel_id: dm.id });
    conv.discord_dm_channel_id = dm.id;
    conv.discord_dm_kind = "dm";
    return { ok: true, mode: "dm" };
  } catch (dmErr) {
    const dmError = (dmErr as Error).message;
    if (!conv.discord_channel_id || !conv.discord_message_id) return { ok: false, mode: null, error: dmError };
    try {
      // Public thread attached to the inbox card. Uses Create Public Threads + Manage Threads, already granted.
      const th = await discord<{ id: string }>("POST", `/channels/${conv.discord_channel_id}/messages/${conv.discord_message_id}/threads`, {
        name: threadTitle(site.name, conv.session_id),
        auto_archive_duration: 1440,
      });
      await discord("PUT", `/channels/${th.id}/thread-members/${userId}`).catch(() => {});
      await postDmHeader(site, { ...conv, discord_dm_channel_id: th.id }, th.id, userId, true);
      await updateConversation(conv.id, { discord_dm_channel_id: th.id, discord_dm_kind: "thread" } as Partial<Conversation>);
      await setActiveChat(userId, { ...conv, claimed_by_id: userId, discord_dm_channel_id: th.id });
      conv.discord_dm_channel_id = th.id;
      conv.discord_dm_kind = "thread";
      return { ok: true, mode: "thread", error: dmError };
    } catch (thErr) {
      return { ok: false, mode: null, error: `${dmError}; thread: ${(thErr as Error).message}` };
    }
  }
}

export function claimOpenedMessage(mode: AgentSessionMode | null, error?: string): string {
  if (mode === "dm") return "📬 I opened a **DM** with you for this visitor. Type a reply there, or press **Reply** under a visitor message.";
  if (mode === "thread" || mode === "private_thread") {
    return "I couldn't DM you — your DMs with the bot may be closed, or the bot needs to share a server with you. I opened a **thread** under this card instead. Type your replies there.";
  }
  return `I claimed the chat, but I couldn't open a DM or a thread under this card. ${error || "Please allow DMs from server members, and make sure the GhostChat bot shares a server with you."} You can still reply from the GhostChat dashboard.`;
}

export async function editInboxCard(conv: Conversation, state: ClaimState, by?: string | null): Promise<void> {
  if (!conv.discord_channel_id || !conv.discord_message_id) return;
  const site = await siteOf(conv);
  if (!site) return;
  const { transcript } = await import("./live.js");
  const lines = await transcript(site.id, conv.session_id, 40);
  const { data: csatRows } = await getDb().from("ghostchat_csat").select("rating, comment").eq("site_id", site.id).eq("session_id", conv.session_id).limit(1);
  const csat = (csatRows || [])[0] as { rating: number; comment: string | null } | undefined;
  const body = {
    embeds: [inboxEmbed(site, conv, lines as Line[], state, by, { rating: csat?.rating ?? null, comment: csat?.comment ?? null })],
    components: inboxComponents(conv.id, state, { claimedByName: conv.claimed_by_name }),
    allowed_mentions: { parse: [] as string[] },
  };
  try {
    await discord("PATCH", `/channels/${conv.discord_channel_id}/messages/${conv.discord_message_id}`, body);
  } catch (e) {
    console.error("inbox edit:", (e as Error).message);
  }
}

export async function postVisitorToAgent(site: Site, conv: Conversation, text: string): Promise<void> {
  const channelId = conv.discord_dm_channel_id || conv.discord_thread_id;
  if (!channelId) return;
  await discord("POST", `/channels/${channelId}/messages`, {
    embeds: [visitorMessageEmbed(site, conv.session_id, text)],
    components: conv.discord_dm_channel_id ? visitorMessageComponents(conv.id) : undefined,
    allowed_mentions: { parse: [] },
  }).catch((e) => console.error("inbox visitor post:", (e as Error).message));
}

export async function postAgentNote(conv: Conversation, content: string, components?: unknown[]): Promise<void> {
  const channelId = conv.discord_dm_channel_id || conv.discord_thread_id;
  if (!channelId) return;
  await discord("POST", `/channels/${channelId}/messages`, {
    content: clip(content, 1900),
    ...(components ? { components } : {}),
    allowed_mentions: { parse: [] },
  }).catch(() => {});
}

export async function finalizeInboxClose(conv: Conversation, opts: { by?: string | null; rating?: number | null } = {}): Promise<void> {
  const site = await siteOf(conv);
  const state: ClaimState = "closed";
  await editInboxCard({ ...conv, status: "closed" }, state, opts.by);
  scheduleClosedCardClear({ ...conv, status: "closed", closed_at: conv.closed_at || new Date().toISOString() }, site);
  if (conv.discord_dm_channel_id && site) {
    const q = agentQuickReplies(site);
    const rating = opts.rating ?? null;
    try {
      await discord("PATCH", `/channels/${conv.discord_dm_channel_id}`, { archived: false, locked: false }).catch(() => {});
      await discord("POST", `/channels/${conv.discord_dm_channel_id}/messages`, {
        content: closeThreadMessage(rating),
        embeds: [dmHeaderEmbed(site, conv, false)],
        components: dmControlComponents(conv.id, "closed", { quickReplies: q }),
        allowed_mentions: { parse: [] },
      });
      if (conv.discord_dm_kind === "thread" || conv.discord_dm_kind === "private_thread") {
        await discord("PATCH", `/channels/${conv.discord_dm_channel_id}`, { archived: true, locked: true }).catch(() => {});
      }
    } catch (e) {
      console.error("inbox dm close:", (e as Error).message);
    }
  }
}

export async function deliverAgentReply(conv: Conversation, text: string, name: string, userId: string): Promise<string | null> {
  await agentReply(conv, text, "discord", name);
  if (conv.close_warned_at) await updateConversation(conv.id, { close_warned_at: null } as Partial<Conversation>);
  await setActiveChat(userId, conv);
  const site = await siteOf(conv);
  const open = await countOpenChats(userId);
  return site ? sentConfirmation(site.name, conv.session_id, open) : null;
}

async function warnIdle(conv: Conversation, site: Site): Promise<void> {
  const warning = 2;
  await updateConversation(conv.id, { close_warned_at: new Date().toISOString() } as Partial<Conversation>);
  const { addLog } = await import("./live.js");
  await addLog({
    site_id: site.id, session_id: conv.session_id, role: "system", thread: "support",
    message: `Are you still there? This chat will close in about ${warning} minutes if no one replies.`,
  });
  await postAgentNote(conv, `⚠️ No messages for a while. This chat with **${visitorTag(site.name, conv.session_id)}** will close in about ${warning} minutes if no one replies.`);
}

/** Remove a closed chat's inbox card and fallback thread from the support channel. Never touches DMs or open tickets. */
export async function clearClosedDiscordCard(convId: string, now = Date.now()): Promise<"cleared" | "skipped" | "failed"> {
  const fresh = await getConversationById(convId);
  if (!fresh) return "skipped";
  // Guard at the moment of deletion: open, waiting, or in-progress chats stay put.
  if (fresh.status !== "closed") return "skipped";
  const site = await siteOf(fresh);
  if (!site || !shouldClearClosedDiscord(fresh, liveSettings(site), now)) return "skipped";
  const targets = closedDiscordCleanupTargets(fresh);
  try {
    for (const tid of targets.threads) {
      await discord("PATCH", `/channels/${tid}`, { archived: false, locked: false }).catch(() => {});
      try {
        await discord("DELETE", `/channels/${tid}`);
      } catch (e) {
        if (!/Discord 404\b/.test((e as Error).message)) throw e;
      }
    }
    if (targets.card) {
      try {
        await discord("DELETE", `/channels/${targets.card.channelId}/messages/${targets.card.messageId}`);
      } catch (e) {
        if (!/Discord 404\b/.test((e as Error).message)) throw e;
      }
    }
    await updateConversation(fresh.id, { discord_cleared_at: new Date().toISOString() } as Partial<Conversation>);
    return "cleared";
  } catch (e) {
    console.error("clear closed discord:", (e as Error).message);
    return "failed";
  }
}

/** Closed conversations whose channel card is due for removal. Survives restarts via closed_at. */
export async function sweepClosedDiscordCards(now = Date.now()): Promise<{ cleared: number; skipped: number; failed: number }> {
  const { data } = await getDb().from("ghostchat_live_conversations")
    .select("*").eq("status", "closed").is("discord_cleared_at", null).limit(200);
  let cleared = 0, skipped = 0, failed = 0;
  for (const raw of data || []) {
    const conv = raw as Conversation;
    const site = await siteOf(conv);
    if (!site || !shouldClearClosedDiscord(conv, liveSettings(site), now)) {
      skipped++;
      continue;
    }
    const result = await clearClosedDiscordCard(conv.id, now);
    if (result === "cleared") cleared++;
    else if (result === "failed") failed++;
    else skipped++;
  }
  return { cleared, skipped, failed };
}

function scheduleClosedCardClear(conv: Conversation, site?: Site | null): void {
  if (process.env.NODE_ENV === "test") return;
  const settings = site ? liveSettings(site) : { clear_closed_discord: true, clear_closed_discord_sec: 60 };
  if (!settings.clear_closed_discord) return;
  const delaySec = clearClosedDiscordSec(settings);
  const closed = Date.parse(conv.closed_at || conv.updated_at || "") || Date.now();
  const wait = Math.max(1_000, closed + delaySec * 1000 - Date.now());
  setTimeout(() => {
    clearClosedDiscordCard(conv.id).catch((e) => console.error("scheduled clear closed discord:", (e as Error).message));
  }, wait).unref();
}

/** Warn, then auto-close, claimed chats that have been silent. */
export async function sweepIdleLiveChats(now = Date.now()): Promise<{ warned: number; closed: number }> {
  const { idleAction } = await import("./live.js");
  const { data } = await getDb().from("ghostchat_live_conversations").select("*").eq("status", "human").limit(200);
  let warned = 0, closed = 0;
  for (const raw of data || []) {
    const conv = raw as Conversation;
    const site = await siteOf(conv);
    if (!site) continue;
    const action = idleAction(conv, liveSettings(site), now);
    if (action === "warn") {
      await warnIdle(conv, site).catch((e) => console.error("idle warn:", (e as Error).message));
      warned++;
    } else if (action === "close") {
      await endLiveChat(conv, "idle", "end").catch((e) => console.error("idle close:", (e as Error).message));
      closed++;
    }
  }
  return { warned, closed };
}

export function startIdleSweep(): void {
  if (String(process.env.IDLE_SWEEP || "").toLowerCase() === "off" || process.env.NODE_ENV === "test") return;
  const tick = () => sweepIdleLiveChats().then((r) => {
    if (r.warned || r.closed) console.log("idle sweep:", JSON.stringify(r));
  }).catch((e) => console.error("idle sweep failed:", (e as Error).message));
  const clearTick = () => sweepClosedDiscordCards().then((r) => {
    if (r.cleared || r.failed) console.log("closed discord clear:", JSON.stringify(r));
  }).catch((e) => console.error("closed discord clear failed:", (e as Error).message));
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 30_000).unref();
  setTimeout(clearTick, 15_000).unref();
  setInterval(clearTick, 15_000).unref();
}

export { lastActivityMs };
export type { ClaimState, Line };
