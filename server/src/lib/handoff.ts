/** Live-chat state transitions shared by the widget route, dashboard Inbox and channel webhooks. */
import { getDb } from "./supabase.js";
import {
  addLog, agentDisplayName, getConversation, transcript, updateConversation, setTyping,
  sanitizeAgentName, type Conversation,
} from "./live.js";
import { announceHandoff, echoToChannels, relayVisitor } from "./relay.js";
import type { Site } from "../types.js";

export async function loadSite(id: string): Promise<Site | null> {
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", id).maybeSingle();
  return (data as Site) ?? null;
}
async function ownerName(ownerId: string): Promise<string | null> {
  const { data } = await getDb().from("ghostchat_owners").select("name").eq("id", ownerId).maybeSingle();
  return (data as { name: string | null } | null)?.name ?? null;
}
export async function agentNameFor(site: Site): Promise<string> {
  return agentDisplayName(site, await ownerName(site.owner_id));
}

export async function rememberOwnerAgentName(ownerId: string, name: string): Promise<void> {
  const clean = sanitizeAgentName(name);
  if (!clean) return;
  await getDb().from("ghostchat_owners").update({ agent_display_name: clean }).eq("id", ownerId);
}

/** Start (or restart) a live conversation and notify the owner's channels. */
export async function startHandoff(site: Site, sessionId: string, reason: "asked" | "misses" | "manual", pageUrl?: string | null): Promise<Conversation> {
  const agent = await agentNameFor(site);
  const existing = await getConversation(site.id, sessionId);
  let conv: Conversation;
  const status = reason === "manual" ? "human" : "waiting";
  if (existing) {
    const fresh = existing.status === "bot" || existing.status === "closed";
    const patch: Partial<Conversation> = { status: fresh ? status : existing.status === "waiting" && reason === "manual" ? "human" : existing.status, reason, agent_name: agent, page_url: pageUrl ?? existing.page_url, review_pending: false };
    if (fresh) {
      // Keep any existing Discord thread so a new handoff reuses it instead of opening a duplicate.
      Object.assign(patch, { telegram_chat_id: null, telegram_thread_id: null, claimed_by_id: null, claimed_by_name: null, claimed_at: null, waiting_since: new Date().toISOString(), last_agent_at: null, closed_at: null, discord_cleared_at: null });
    }
    await updateConversation(existing.id, patch);
    conv = { ...existing, ...patch } as Conversation;
    if (!fresh) return conv;
  } else {
    const { data, error } = await getDb().from("ghostchat_live_conversations").insert({
      site_id: site.id, owner_id: site.owner_id, session_id: sessionId, status, reason, agent_name: agent, page_url: pageUrl ?? null,
      last_visitor_at: new Date().toISOString(), waiting_since: new Date().toISOString(), review_pending: false,
    }).select("*").single();
    if (error) {
      // a concurrent insert won the unique (site_id, session_id) race
      const again = await getConversation(site.id, sessionId);
      if (again) return again;
      throw error;
    }
    conv = data as Conversation;
  }
  const recent = (await transcript(site.id, sessionId, 50)).map((m) => ({ role: m.role, message: m.message }));
  announceHandoff(site, conv, recent, reason).catch((e) => console.error("live announce:", (e as Error).message));
  return conv;
}

/** Visitor message while a human has the chat: log it and relay it; no AI reply, no message charge. */
export async function visitorLiveMessage(site: Site, conv: Conversation, message: string, pageUrl: string | null): Promise<void> {
  await addLog({ site_id: site.id, session_id: conv.session_id, role: "user", message, page_url: pageUrl, thread: "support" });
  await updateConversation(conv.id, { last_visitor_at: new Date().toISOString(), close_warned_at: null } as Partial<Conversation>);
  relayVisitor(site, conv, message).catch(() => {});
  if (conv.discord_message_id || conv.discord_panel_id || conv.discord_thread_id) {
    import("./discordClaim.js").then((m) => m.refreshLiveControls(conv, undefined, conv.claimed_by_id)).catch(() => {});
  }
}

/** A human reply from the dashboard, Telegram or Discord. */
export async function agentReply(conv: Conversation, text: string, via: "dashboard" | "telegram" | "discord", name?: string | null): Promise<string | null> {
  const site = await loadSite(conv.site_id);
  if (!site) return null;
  const agent = sanitizeAgentName(name) || sanitizeAgentName(conv.agent_name) || (await agentNameFor(site));
  if (conv.status === "waiting") {
    await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${agent} joined the chat`, thread: "support" });
    if (conv.discord_message_id && !conv.claimed_by_id && via !== "discord") {
      import("./discordClaim.js").then((m) => m.editClaimMessage({ ...conv, status: "human" }, "claimed", null)).catch(() => {});
    }
  }
  const id = await addLog({ site_id: site.id, session_id: conv.session_id, role: "agent", message: text.slice(0, 4000), agent_name: agent, thread: "support" });
  await updateConversation(conv.id, { status: "human", agent_name: agent, last_agent_at: new Date().toISOString(), close_warned_at: null } as Partial<Conversation>);
  if (via === "dashboard") echoToChannels(conv, `🧑 ${agent} (dashboard): ${text}`).catch(() => {});
  if (conv.discord_message_id || conv.discord_panel_id || conv.discord_thread_id) {
    const next = { ...conv, status: "human" as const, agent_name: agent };
    import("./discordClaim.js").then((m) => m.refreshLiveControls(next, "claimed", conv.claimed_by_id)).catch(() => {});
  }
  return id;
}

export async function takeOver(conv: Conversation, name?: string | null): Promise<void> {
  const site = await loadSite(conv.site_id);
  const agent = sanitizeAgentName(name) || sanitizeAgentName(conv.agent_name) || (site ? await agentNameFor(site) : "Team");
  if (conv.status !== "human" && site) {
    await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${agent} joined the chat`, thread: "support" });
  }
  await updateConversation(conv.id, { status: "human", agent_name: agent, review_pending: false });
}

export type EndKind = "end" | "cancel" | "handback";
export type EndVia = "visitor" | "dashboard" | "telegram" | "discord" | "idle";

export function endChatSystemMessage(kind: EndKind): string {
  if (kind === "cancel") return "The request for a team member was cancelled. You're back with the AI assistant.";
  if (kind === "handback") return "You're back with the AI assistant.";
  return "You're back with the AI assistant.";
}

export function endChatAgentNotice(kind: EndKind, via: EndVia): string {
  if (kind === "cancel") return "🚫 The visitor cancelled the request for a team member.";
  if (kind === "handback") return "🤖 The chat was handed back to the AI assistant. The visitor can leave a review.";
  if (via === "visitor") return "👋 The visitor ended the chat with the team and was asked to leave a review.";
  if (via === "idle") return "⏱️ This chat was closed after a period of inactivity. The visitor was asked to leave a review.";
  return "✅ This live chat was closed. The visitor can leave a review.";
}

export async function closeOpenTickets(siteId: string, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb().from("ghostchat_tickets")
    .update({ status: "solved", updated_at: now, solved_at: now })
    .eq("site_id", siteId).eq("session_id", sessionId).in("status", ["open", "pending"]);
}

export async function clearReviewPending(siteId: string, sessionId: string): Promise<void> {
  await getDb().from("ghostchat_live_conversations").update({ review_pending: false, updated_at: new Date().toISOString() }).eq("site_id", siteId).eq("session_id", sessionId);
}

export type ClosedConversation = Conversation & { discordArchive?: { ok: boolean; error?: string; archived: number } };

/** End or cancel a live handoff: close the support thread, notify the agent, optionally prompt for a review, and archive the Discord thread. */
export async function endLiveChat(conv: Conversation, via: EndVia, kind: EndKind = "end"): Promise<ClosedConversation> {
  const already = conv.status === "closed" && kind !== "cancel";
  const site = already ? null : await loadSite(conv.site_id);
  const review = kind !== "cancel";
  const closedAt = conv.closed_at || new Date().toISOString();
  const patch: Partial<Conversation> = already
    ? { status: "closed", review_pending: conv.review_pending || review }
    : { status: "closed", claimed_by_id: null, claimed_by_name: null, review_pending: review, closed_at: closedAt };
  if (!already) {
    await updateConversation(conv.id, patch);
    if (site) {
      await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: endChatSystemMessage(kind), thread: "support" });
      if (review) await closeOpenTickets(site.id, conv.session_id);
    }
    echoToChannels(conv, endChatAgentNotice(kind, via), via === "visitor" || via === "dashboard" ? undefined : via).catch(() => {});
  } else if (review && !conv.review_pending) {
    await updateConversation(conv.id, { review_pending: true });
  }
  const ended = { ...conv, ...patch } as ClosedConversation;
  if (kind !== "cancel" && (conv.discord_message_id || conv.discord_channel_id || conv.discord_panel_id || conv.discord_thread_id)) {
    try {
      const m = await import("./discordClaim.js");
      ended.discordArchive = await m.finalizeLiveClose(ended, {});
    } catch (e) {
      ended.discordArchive = { ok: false, error: (e as Error).message, archived: 0 };
    }
  }
  return ended;
}

export async function handBack(conv: Conversation, via: "dashboard" | "telegram" | "discord"): Promise<void> {
  await endLiveChat(conv, via, "handback");
}

export function agentTyping(conv: Conversation): void {
  setTyping(conv.id, "agent");
}
