/** Live-chat state transitions shared by the widget route, dashboard Inbox and channel webhooks. */
import { getDb } from "./supabase.js";
import {
  addLog, agentDisplayName, getConversation, transcript, updateConversation, setTyping,
  type Conversation,
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

/** Start (or restart) a live conversation and notify the owner's channels. */
export async function startHandoff(site: Site, sessionId: string, reason: "asked" | "misses" | "manual", pageUrl?: string | null): Promise<Conversation> {
  const agent = await agentNameFor(site);
  const existing = await getConversation(site.id, sessionId);
  let conv: Conversation;
  const status = reason === "manual" ? "human" : "waiting";
  if (existing) {
    const fresh = existing.status === "bot" || existing.status === "closed";
    const patch: Partial<Conversation> = { status: fresh ? status : existing.status === "waiting" && reason === "manual" ? "human" : existing.status, reason, agent_name: agent, page_url: pageUrl ?? existing.page_url };
    if (fresh) Object.assign(patch, { telegram_chat_id: null, telegram_thread_id: null, discord_thread_id: null, discord_channel_id: null, discord_message_id: null, claimed_by_id: null, claimed_by_name: null, claimed_at: null, waiting_since: new Date().toISOString(), last_agent_at: null });
    await updateConversation(existing.id, patch);
    conv = { ...existing, ...patch } as Conversation;
    if (!fresh) return conv;
  } else {
    const { data, error } = await getDb().from("ghostchat_live_conversations").insert({
      site_id: site.id, owner_id: site.owner_id, session_id: sessionId, status, reason, agent_name: agent, page_url: pageUrl ?? null,
      last_visitor_at: new Date().toISOString(), waiting_since: new Date().toISOString(),
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
  await addLog({ site_id: site.id, session_id: conv.session_id, role: "user", message, page_url: pageUrl });
  await updateConversation(conv.id, { last_visitor_at: new Date().toISOString() });
  relayVisitor(site, conv, message).catch(() => {});
}

/** A human reply from the dashboard, Telegram or Discord. */
export async function agentReply(conv: Conversation, text: string, via: "dashboard" | "telegram" | "discord", name?: string | null): Promise<string | null> {
  const site = await loadSite(conv.site_id);
  if (!site) return null;
  const agent = name || conv.agent_name || (await agentNameFor(site));
  if (conv.status === "waiting") {
    await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${agent} joined the chat` });
    if (conv.discord_message_id && !conv.claimed_by_id && via !== "discord") {
      import("./discordClaim.js").then((m) => m.editClaimMessage({ ...conv, status: "human" }, "claimed", null)).catch(() => {});
    }
  }
  const id = await addLog({ site_id: site.id, session_id: conv.session_id, role: "agent", message: text.slice(0, 4000), agent_name: agent });
  await updateConversation(conv.id, { status: "human", agent_name: agent, last_agent_at: new Date().toISOString() });
  if (via === "dashboard") echoToChannels(conv, `🧑 ${agent} (dashboard): ${text}`).catch(() => {});
  return id;
}

export async function takeOver(conv: Conversation): Promise<void> {
  await updateConversation(conv.id, { status: "human" });
}

export async function handBack(conv: Conversation, via: "dashboard" | "telegram" | "discord"): Promise<void> {
  const site = await loadSite(conv.site_id);
  await updateConversation(conv.id, { status: "bot" });
  if (site) await addLog({ site_id: site.id, session_id: conv.session_id, role: "system", message: `${conv.agent_name || "The team"} handed the chat back to the AI assistant.` });
  echoToChannels(conv, "🤖 Chat handed back to the AI assistant.", via === "dashboard" ? undefined : via).catch(() => {});
}

export function agentTyping(conv: Conversation): void {
  setTyping(conv.id, "agent");
}
