import { Router, type Request } from "express";
import { getDb } from "../lib/supabase.js";
import { config } from "../config.js";
import type { AuthedRequest } from "../lib/auth.js";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import {
  LIVE_PLANS, channelWebhookSecret, encryptSecret, findRelay, getConversation, getConversationById, isTyping,
  liveSettings, newLinkCode, normalizeLiveSettings, handoffTimedOut, ownerChannels, resolveAgentName, sanitizeAgentName,
  setTyping, telegramAgentName, transcript, withTelegramAgentName,
  type Conversation,
} from "../lib/live.js";
import { agentNameFor, agentReply, agentTyping, endChatSystemMessage, endLiveChat, handBack, loadSite, rememberOwnerAgentName, startHandoff, takeOver } from "../lib/handoff.js";
import {
  DISCORD_INVITE_URL, TELEGRAM_BOT_USERNAME, discord, discordReady, discordTextChannels, telegramReady, telegramTokenFor, tg, verifyDiscordRelay,
} from "../lib/relay.js";
import { applyTimeout, handleClaimComponent, supportName, GCL } from "../lib/discordClaim.js";
import { conversationForAgentChannel, deliverAgentReply } from "../lib/discordInbox.js";
import type { Site } from "../types.js";

const ownerOf = (req: Request) => (req as unknown as AuthedRequest).owner;
const LINK_TTL_MS = 30 * 60_000;
const tgNameWait = new Map<string, { convId: string; action: string }>();

async function siteByKey(key: string): Promise<Site | null> {
  if (!String(key).startsWith("gc_")) return null;
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("site_key", key).maybeSingle();
  return (data as Site) ?? null;
}

// ---------------------------------------------------------------- widget (public)
export const liveWidgetRouter = Router();

liveWidgetRouter.get("/:siteKey/:sessionId", async (req, res) => {
  if (!(await rateLimitAsync(`live:poll:${clientIp(req)}`, 180, 60_000)).ok) return res.status(429).json({ error: "Too many requests." });
  const site = await siteByKey(req.params.siteKey);
  if (!site) return res.status(404).json({ error: "Unknown site key." });
  const sessionId = String(req.params.sessionId).slice(0, 80);
  let conv = await getConversation(site.id, sessionId);
  let fallback: "ai" | "form" | null = null;
  if (conv && handoffTimedOut(conv, liveSettings(site))) {
    fallback = await applyTimeout(site, conv);
    conv = { ...conv, status: "bot" };
  }
  const after = typeof req.query.after === "string" && !Number.isNaN(Date.parse(req.query.after)) ? req.query.after : null;
  let q = getDb().from("ghostchat_logs").select("id, role, message, agent_name, created_at")
    .eq("site_id", site.id).eq("session_id", sessionId).eq("thread", "support");
  if (after) q = q.gt("created_at", after);
  const { data } = await q.order("created_at", { ascending: true }).limit(100);
  const { data: tickets } = await getDb().from("ghostchat_tickets").select("id").eq("site_id", site.id).eq("session_id", sessionId).limit(1);
  const ticket = (tickets || [])[0];
  const { data: csatRows } = await getDb().from("ghostchat_csat").select("id").eq("site_id", site.id).eq("session_id", sessionId).limit(1);
  const hasCsat = Boolean((csatRows || []).length);
  const cancelNote = endChatSystemMessage("cancel");
  const sawCancel = (data || []).some((m: { role?: string; message?: string }) => m.role === "system" && m.message === cancelNote);
  let reviewPending = !hasCsat && Boolean(conv) && !sawCancel && (Boolean(conv?.review_pending) || conv?.status === "closed");
  const liveSupport = conv?.status === "human" || conv?.status === "waiting";
  res.setHeader("cache-control", "no-store");
  res.json({
    status: conv?.status || "bot",
    agentName: conv?.agent_name || null,
    typing: conv ? isTyping(conv.id, "agent") : false,
    messages: data || [],
    fallback,
    reviewPending,
    hasTicket: Boolean(ticket),
    hasSupport: Boolean(liveSupport || reviewPending || ticket),
  });
});

liveWidgetRouter.post("/:siteKey/:sessionId/end", async (req, res) => {
  if (!(await rateLimitAsync(`live:end:${clientIp(req)}`, 20, 60_000)).ok) return res.status(429).json({ error: "Too many requests." });
  const site = await siteByKey(req.params.siteKey);
  if (!site) return res.status(404).json({ error: "Unknown site key." });
  const conv = await getConversation(site.id, String(req.params.sessionId).slice(0, 80));
  if (!conv) return res.json({ ok: true, status: "bot", reviewPending: false });
  if (conv.status !== "waiting" && conv.status !== "human") {
    return res.json({ ok: true, status: conv.status, reviewPending: Boolean(conv.review_pending), agentName: conv.agent_name });
  }
  let kind: "end" | "cancel" = req.body?.reason === "cancel" ? "cancel" : "end";
  if (kind === "cancel" && conv.status !== "waiting") kind = "end";
  const ended = await endLiveChat(conv, "visitor", kind);
  res.json({ ok: true, status: ended.status, reviewPending: Boolean(ended.review_pending), agentName: ended.agent_name, message: endChatSystemMessage(kind) });
});

liveWidgetRouter.post("/:siteKey/:sessionId/typing", async (req, res) => {
  if (!(await rateLimitAsync(`live:typing:${clientIp(req)}`, 60, 60_000)).ok) return res.status(429).end();
  const site = await siteByKey(req.params.siteKey);
  const conv = site ? await getConversation(site.id, String(req.params.sessionId).slice(0, 80)) : null;
  if (conv && (conv.status === "human" || conv.status === "waiting")) setTyping(conv.id, "visitor");
  res.status(204).end();
});

// ---------------------------------------------------------------- owner (authed)
export const liveOwnerRouter = Router();

function publicChannel(c: Awaited<ReturnType<typeof ownerChannels>>[number]) {
  const cfg = c.config || {};
  return {
    id: c.id, kind: c.kind, status: c.status, own_bot: Boolean(c.secret_enc),
    chat_title: cfg.chat_title ?? null, chat_type: cfg.chat_type ?? null, is_forum: Boolean(cfg.is_forum),
    bot_username: cfg.bot_username ?? null, guild_id: cfg.guild_id ?? null, guild_name: cfg.guild_name ?? null,
    channel_id: cfg.channel_id ?? null, channel_name: cfg.channel_name ?? null,
    link_code: c.status === "pending" ? c.link_code : null,
  };
}

liveOwnerRouter.get("/overview", async (req, res) => {
  const owner = ownerOf(req);
  const channels = (await ownerChannels(owner.id)).map(publicChannel);
  const { data: sites } = await getDb().from("ghostchat_sites").select("id, name, plan, live_chat").eq("owner_id", owner.id);
  const agent = resolveAgentName({ remembered: owner.agent_display_name, discordId: owner.discord_id, discordName: owner.name });
  res.json({
    channels,
    telegram: { ready: telegramReady(), bot: TELEGRAM_BOT_USERNAME },
    discord: { ready: discordReady(), invite: DISCORD_INVITE_URL },
    agent_name: agent.name,
    need_name: agent.needsName,
    sites: (sites || []).map((s) => ({ id: s.id, name: s.name, plan: s.plan, pro: LIVE_PLANS.has(s.plan), live_chat: liveSettings(s as Site) })),
  });
});

liveOwnerRouter.patch("/settings/:siteId", async (req, res) => {
  const owner = ownerOf(req);
  const site = await loadSite(req.params.siteId);
  if (!site || site.owner_id !== owner.id) return res.status(404).json({ error: "Bot not found." });
  const next = normalizeLiveSettings(req.body?.live_chat ?? req.body, liveSettings(site));
  if (next.enabled && !LIVE_PLANS.has(site.plan)) return res.status(402).json({ error: "Live chat is a Pro feature. Upgrade to turn it on.", upgrade: true });
  await getDb().from("ghostchat_sites").update({ live_chat: next }).eq("id", site.id);
  res.json({ live_chat: next });
});

async function upsertChannel(ownerId: string, kind: "telegram" | "discord", patch: Record<string, unknown>) {
  const { data, error } = await getDb().from("ghostchat_live_channels")
    .upsert({ owner_id: ownerId, kind, updated_at: new Date().toISOString(), ...patch }, { onConflict: "owner_id,kind" }).select("*").single();
  if (error) throw error;
  return data as Awaited<ReturnType<typeof ownerChannels>>[number];
}

// Telegram: shared bot (one-click /start link) or the owner's own BotFather token.
liveOwnerRouter.post("/channels/telegram", async (req, res) => {
  const owner = ownerOf(req);
  const code = newLinkCode();
  const expires = new Date(Date.now() + LINK_TTL_MS).toISOString();
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  try {
    if (!token) {
      if (!telegramReady()) return res.status(503).json({ error: "The shared GhostChat Telegram bot isn't configured yet." });
      const ch = await upsertChannel(owner.id, "telegram", { status: "pending", link_code: code, link_expires_at: expires, config: { bot_username: TELEGRAM_BOT_USERNAME }, secret_enc: null, last_error: null });
      return res.json({ channel: publicChannel(ch), code, url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` });
    }
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) return res.status(400).json({ error: "That doesn't look like a BotFather token." });
    const me = await tg<{ username: string }>(token, "getMe", {}).catch(() => null);
    if (!me) return res.status(400).json({ error: "Telegram didn't accept that token." });
    const ch = await upsertChannel(owner.id, "telegram", { status: "pending", link_code: code, link_expires_at: expires, config: { bot_username: me.username }, secret_enc: encryptSecret(token), last_error: null });
    await tg(token, "setWebhook", { url: `${config.publicUrl}/api/webhooks/telegram/${ch.id}`, secret_token: channelWebhookSecret(ch.id), allowed_updates: ["message"], drop_pending_updates: true });
    res.json({ channel: publicChannel(ch), code, url: `https://t.me/${me.username}?start=${code}` });
  } catch (err) {
    console.error("telegram connect:", (err as Error).message);
    res.status(502).json({ error: "Couldn't set up Telegram right now. Please try again." });
  }
});

// Discord: owner adds GhostBot with the invite, then runs /ghostchat link <code> in the channel to use.
liveOwnerRouter.post("/channels/discord", async (req, res) => {
  const owner = ownerOf(req);
  const code = newLinkCode();
  const ch = await upsertChannel(owner.id, "discord", { status: "pending", link_code: code, link_expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(), last_error: null });
  res.json({ channel: publicChannel(ch), code, invite: DISCORD_INVITE_URL, command: `/ghostchat link ${code}` });
});

liveOwnerRouter.get("/channels/discord/channels", async (req, res) => {
  const ch = (await ownerChannels(ownerOf(req).id)).find((c) => c.kind === "discord");
  const guild = String(ch?.config?.guild_id || "");
  if (!guild) return res.status(400).json({ error: "Link a Discord server first." });
  try { res.json({ channels: await discordTextChannels(guild) }); }
  catch { res.status(502).json({ error: "Couldn't read that server's channels. Is GhostBot still in it?" }); }
});

liveOwnerRouter.post("/channels/discord/channel", async (req, res) => {
  const ch = (await ownerChannels(ownerOf(req).id)).find((c) => c.kind === "discord");
  const guild = String(ch?.config?.guild_id || "");
  if (!ch || !guild) return res.status(400).json({ error: "Link a Discord server first." });
  const list = await discordTextChannels(guild).catch(() => []);
  const pick = list.find((c) => c.id === String(req.body?.channelId || ""));
  if (!pick) return res.status(400).json({ error: "Pick a text channel from your server." });
  const { data } = await getDb().from("ghostchat_live_channels").update({ status: "connected", config: { ...ch.config, channel_id: pick.id, channel_name: pick.name }, updated_at: new Date().toISOString() }).eq("id", ch.id).select("*").single();
  res.json({ channel: publicChannel(data as never) });
});

liveOwnerRouter.post("/channels/:kind/test", async (req, res) => {
  const ch = (await ownerChannels(ownerOf(req).id)).find((c) => c.kind === req.params.kind);
  if (!ch || ch.status !== "connected") return res.status(400).json({ error: "Connect this channel first." });
  try {
    const text = "✅ GhostChat test: live chats from your website will show up here.";
    if (ch.kind === "telegram") await tg(telegramTokenFor(ch), "sendMessage", { chat_id: ch.config.chat_id, text });
    else await discord("POST", `/channels/${ch.config.channel_id}/messages`, { content: text, allowed_mentions: { parse: [] } });
    await getDb().from("ghostchat_live_channels").update({ last_error: null }).eq("id", ch.id);
    res.json({ ok: true });
  } catch (err) {
    await getDb().from("ghostchat_live_channels").update({ last_error: (err as Error).message.slice(0, 300) }).eq("id", ch.id);
    res.status(502).json({ error: "The test message didn't go through. Check the bot can post there." });
  }
});

liveOwnerRouter.delete("/channels/:kind", async (req, res) => {
  const owner = ownerOf(req);
  const ch = (await ownerChannels(owner.id)).find((c) => c.kind === req.params.kind);
  if (ch?.kind === "telegram" && ch.secret_enc) await tg(telegramTokenFor(ch), "deleteWebhook", {}).catch(() => {});
  await getDb().from("ghostchat_live_channels").delete().eq("owner_id", owner.id).eq("kind", req.params.kind);
  res.json({ ok: true });
});

// ---- Inbox ----
async function ownedConversation(req: Request): Promise<Conversation | null> {
  const conv = await getConversationById(String(req.params.id));
  return conv && conv.owner_id === ownerOf(req).id ? conv : null;
}

liveOwnerRouter.get("/inbox", async (req, res) => {
  const owner = ownerOf(req);
  const { data: sites } = await getDb().from("ghostchat_sites").select("id, name").eq("owner_id", owner.id);
  const siteName = new Map((sites || []).map((s) => [s.id, s.name]));
  const { data: convs } = await getDb().from("ghostchat_live_conversations").select("*").eq("owner_id", owner.id).order("updated_at", { ascending: false }).limit(50);
  // Recent AI-only sessions (last 48h) so the owner can take over manually.
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const ids = [...siteName.keys()];
  const { data: logs } = ids.length
    ? await getDb().from("ghostchat_logs").select("site_id, session_id, role, message, created_at").in("site_id", ids).gt("created_at", since).order("created_at", { ascending: false }).limit(400)
    : { data: [] as Array<{ site_id: string; session_id: string; role: string; message: string; created_at: string }> };
  const last = new Map<string, { message: string; role: string; created_at: string; count: number }>();
  for (const l of logs || []) {
    const k = `${l.site_id}:${l.session_id}`;
    const cur = last.get(k);
    if (!cur) last.set(k, { message: l.message, role: l.role, created_at: l.created_at, count: 1 });
    else cur.count++;
  }
  const live = (convs || []) as Conversation[];
  const liveKeys = new Set(live.map((c) => `${c.site_id}:${c.session_id}`));
  const toItem = (c: Conversation) => {
    const l = last.get(`${c.site_id}:${c.session_id}`);
    return { id: c.id, site_id: c.site_id, site_name: siteName.get(c.site_id) || "", session_id: c.session_id, status: c.status, reason: c.reason, agent_name: c.agent_name, page_url: c.page_url, updated_at: l?.created_at || c.updated_at, preview: l?.message?.slice(0, 140) || "", visitor_typing: isTyping(c.id, "visitor") };
  };
  const recent = [...last.entries()].filter(([k]) => !liveKeys.has(k)).slice(0, 30).map(([k, l]) => {
    const [site_id, session_id] = [k.slice(0, 36), k.slice(37)];
    return { id: null, site_id, site_name: siteName.get(site_id) || "", session_id, status: "ai", updated_at: l.created_at, preview: l.message.slice(0, 140), messages: l.count };
  });
  res.json({ live: live.filter((c) => c.status !== "closed").map(toItem), recent });
});

liveOwnerRouter.get("/inbox/session/:siteId/:sessionId", async (req, res) => {
  const site = await loadSite(req.params.siteId);
  if (!site || site.owner_id !== ownerOf(req).id) return res.status(404).json({ error: "Not found." });
  const conv = await getConversation(site.id, req.params.sessionId);
  res.json({ conversation: conv, site: { id: site.id, name: site.name }, messages: await transcript(site.id, req.params.sessionId), visitor_typing: conv ? isTyping(conv.id, "visitor") : false });
});


async function resolveOwnerAgent(req: Request, provided?: string | null, remember = true) {
  const owner = ownerOf(req);
  const resolved = resolveAgentName({
    provided,
    remembered: owner.agent_display_name,
    discordId: owner.discord_id,
    discordName: owner.name,
  });
  if (!resolved.needsName && remember && resolved.source === "provided" && resolved.name) {
    await rememberOwnerAgentName(owner.id, resolved.name);
    owner.agent_display_name = resolved.name;
  }
  return resolved;
}

liveOwnerRouter.post("/inbox/take", async (req, res) => {
  const site = await loadSite(String(req.body?.siteId || ""));
  if (!site || site.owner_id !== ownerOf(req).id) return res.status(404).json({ error: "Not found." });
  if (!LIVE_PLANS.has(site.plan)) return res.status(402).json({ error: "Live chat is a Pro feature.", upgrade: true });
  const agent = await resolveOwnerAgent(req, typeof req.body?.agentName === "string" ? req.body.agentName : null);
  if (agent.needsName) return res.status(400).json({ error: "Enter the name visitors will see in the chat.", needName: true });
  const conv = await startHandoff(site, String(req.body?.sessionId || "").slice(0, 80), "manual");
  await takeOver(conv, agent.name);
  res.json({ conversation: { ...conv, status: "human", agent_name: agent.name }, agentName: agent.name });
});

liveOwnerRouter.post("/inbox/:id/reply", async (req, res) => {
  const conv = await ownedConversation(req);
  if (!conv) return res.status(404).json({ error: "Not found." });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Write a reply first." });
  const agent = await resolveOwnerAgent(req, typeof req.body?.agentName === "string" ? req.body.agentName : null);
  if (agent.needsName) return res.status(400).json({ error: "Enter the name visitors will see in the chat.", needName: true });
  const id = await agentReply(conv, text, "dashboard", agent.name);
  res.json({ ok: true, id, agentName: agent.name });
});
liveOwnerRouter.post("/inbox/:id/typing", async (req, res) => {
  const conv = await ownedConversation(req);
  if (conv) agentTyping(conv);
  res.status(204).end();
});
liveOwnerRouter.post("/inbox/:id/takeover", async (req, res) => {
  const conv = await ownedConversation(req);
  if (!conv) return res.status(404).json({ error: "Not found." });
  await takeOver(conv);
  res.json({ ok: true });
});
liveOwnerRouter.post("/inbox/:id/handback", async (req, res) => {
  const conv = await ownedConversation(req);
  if (!conv) return res.status(404).json({ error: "Not found." });
  await handBack(conv, "dashboard");
  res.json({ ok: true });
});
liveOwnerRouter.post("/inbox/:id/close", async (req, res) => {
  const conv = await ownedConversation(req);
  if (!conv) return res.status(404).json({ error: "Not found." });
  await endLiveChat(conv, "dashboard", "end");
  res.json({ ok: true });
});

// ---------------------------------------------------------------- webhooks
type TgMessage = {
  message_id: number; text?: string; chat: { id: number; type: string; title?: string; first_name?: string; is_forum?: boolean };
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  message_thread_id?: number; is_topic_message?: boolean; reply_to_message?: { message_id: number };
};
type ChannelRow = Awaited<ReturnType<typeof ownerChannels>>[number];

async function tgReply(token: string, m: TgMessage, text: string) {
  await tg(token, "sendMessage", { chat_id: m.chat.id, text, ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}), reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }).catch(() => {});
}

/** Core Telegram update handling. `fixed` is the channel for an owner's own bot; shared-bot updates look the chat up. */
export async function handleTelegramUpdate(update: { message?: TgMessage }, fixed: ChannelRow | null): Promise<void> {
  const m = update.message;
  if (!m?.text || m.from?.is_bot) return;
  const chatId = String(m.chat.id);
  const text = m.text.trim();
  const sharedToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const linkMatch = text.match(/^\/(?:start|link)(?:@\w+)?\s+(GC-[A-Z0-9]{8})\b/i);
  if (linkMatch) {
    const code = linkMatch[1].toUpperCase();
    const { data } = await getDb().from("ghostchat_live_channels").select("*").eq("kind", "telegram").eq("link_code", code).maybeSingle();
    const ch = data as ChannelRow & { link_expires_at: string | null } | null;
    const token = fixed ? telegramTokenFor(fixed) : sharedToken;
    if (!ch || (fixed ? ch.id !== fixed.id : Boolean(ch.secret_enc)) || (ch.link_expires_at && Date.parse(ch.link_expires_at) < Date.now())) {
      return tgReply(token, m, "That link code isn't valid any more. Make a new one in GhostChat › Live chat.");
    }
    await getDb().from("ghostchat_live_channels").update({
      status: "connected", link_code: null, link_expires_at: null, updated_at: new Date().toISOString(),
      config: { ...ch.config, chat_id: chatId, chat_type: m.chat.type, chat_title: m.chat.title || m.chat.first_name || "Telegram", is_forum: Boolean(m.chat.is_forum) },
    }).eq("id", ch.id);
    return tgReply(token, m, `✅ Linked to GhostChat. Live chats from your website will arrive here.${m.chat.is_forum ? " Each visitor gets their own topic (the bot needs admin rights with Manage Topics)." : ""} Reply to a visitor's message to answer; /back hands the chat back to the AI.`);
  }
  if (/^\/start\b/.test(text)) {
    return tgReply(fixed ? telegramTokenFor(fixed) : sharedToken, m, "👻 This is the GhostChat live-chat bot. Open GhostChat › Live chat and press “Connect Telegram” to link this chat.");
  }

  let ch = fixed;
  if (!ch) {
    const { data } = await getDb().from("ghostchat_live_channels").select("*").eq("kind", "telegram").is("secret_enc", null).eq("status", "connected").eq("config->>chat_id", chatId).limit(1).maybeSingle();
    ch = (data as ChannelRow) ?? null;
  }
  if (!ch) return;
  const token = telegramTokenFor(ch);

  let convId: string | null = null;
  if (m.is_topic_message && m.message_thread_id) {
    const { data } = await getDb().from("ghostchat_live_conversations").select("id").eq("owner_id", ch.owner_id).eq("telegram_chat_id", chatId).eq("telegram_thread_id", m.message_thread_id).limit(1).maybeSingle();
    convId = (data as { id: string } | null)?.id ?? null;
  }
  if (!convId && m.reply_to_message) convId = await findRelay("telegram", chatId, String(m.reply_to_message.message_id));
  if (!convId && m.chat.type === "private") {
    const { data } = await getDb().from("ghostchat_live_conversations").select("id").eq("owner_id", ch.owner_id).eq("telegram_chat_id", chatId).in("status", ["waiting", "human"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    convId = (data as { id: string } | null)?.id ?? null;
  }
  const conv = convId ? await getConversationById(convId) : null;
  if (!conv || conv.owner_id !== ch.owner_id) {
    if (m.chat.type === "private") await tgReply(token, m, "Reply to a visitor's message to answer them.");
    return;
  }
  const fromId = String(m.from?.id || "");
  const remembered = telegramAgentName(ch.config, fromId);
  const tgNameKey = `${ch.id}:${fromId}`;
  if (tgNameWait.has(tgNameKey)) {
    const pending = tgNameWait.get(tgNameKey)!;
    if (/^\//.test(text)) return tgReply(token, m, "Please send the name visitors will see in the chat first (for example: Sam).");
    const name = sanitizeAgentName(text);
    if (!name) return tgReply(token, m, "That name is too short. Send a name of up to 32 characters, with no HTML.");
    await getDb().from("ghostchat_live_channels").update({ config: withTelegramAgentName(ch.config, fromId, name), updated_at: new Date().toISOString() }).eq("id", ch.id);
    ch.config = withTelegramAgentName(ch.config, fromId, name);
    tgNameWait.delete(tgNameKey);
    const waiting = pending.convId === conv.id ? conv : await getConversationById(pending.convId);
    if (pending.action === "take" && waiting) {
      await takeOver(waiting, name);
      return tgReply(token, m, `Thanks, ${name}. You have the chat — the AI will stay quiet. Send your reply to the visitor now.`);
    }
    return tgReply(token, m, `Thanks, ${name}. Visitors will see that name. Send your reply to the visitor now.`);
  }
  if (!remembered && !/^\/(?:start|link|back|close)\b/i.test(text)) {
    const action = /^\/take\b/i.test(text) ? "take" : "reply";
    tgNameWait.set(tgNameKey, { convId: conv.id, action });
    return tgReply(token, m, "Before you join, type the name visitors will see in the chat (for example: Sam). I'll remember it for next time.");
  }
  const agent = remembered || "Team";
  if (/^\/back\b/i.test(text)) { await handBack(conv, "telegram"); return tgReply(token, m, "🤖 Handed back to the AI assistant. The visitor can leave a review."); }
  if (/^\/close\b/i.test(text)) { await endLiveChat(conv, "telegram", "end"); return tgReply(token, m, "✅ Chat closed. The visitor can leave a review."); }
  if (/^\/take\b/i.test(text)) { await takeOver(conv, agent); return tgReply(token, m, `🧑 You have the chat as ${agent}. The AI will stay quiet.`); }
  if (conv.status === "bot" || conv.status === "closed") return tgReply(token, m, "This chat was handed back to the AI. Send /take (as a reply) to jump back in.");
  await agentReply(conv, text, "telegram", agent);
}

export const telegramWebhookRouter = Router();
telegramWebhookRouter.post("/", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret || req.header("x-telegram-bot-api-secret-token") !== secret) return res.status(401).end();
  res.json({ ok: true });
  handleTelegramUpdate(req.body || {}, null).catch((e) => console.error("telegram webhook:", (e as Error).message));
});
telegramWebhookRouter.post("/:channelId", async (req, res) => {
  const { data } = await getDb().from("ghostchat_live_channels").select("*").eq("id", req.params.channelId).maybeSingle();
  const ch = data as ChannelRow | null;
  if (!ch?.secret_enc || req.header("x-telegram-bot-api-secret-token") !== channelWebhookSecret(ch.id)) return res.status(401).end();
  res.json({ ok: true });
  handleTelegramUpdate(req.body || {}, ch).catch((e) => console.error("telegram own webhook:", (e as Error).message));
});

/** Relayed from the GhostBot gateway / interactions (HMAC-signed). */
export async function handleDiscordRelay(body: Record<string, unknown>): Promise<{ status: number; reply?: string; response?: Record<string, unknown>; ignored?: boolean }> {
  if (body.type === "component" || body.type === "modal") {
    const customId = String(body.custom_id || "");
    const ev = {
      custom_id: customId, user_id: String(body.user_id || ""), user_name: String(body.user_name || "Team"),
      permissions: typeof body.permissions === "string" ? body.permissions : undefined,
      values: Array.isArray(body.values) ? body.values.map(String) : undefined,
      resolved_names: (body.resolved_names && typeof body.resolved_names === "object") ? body.resolved_names as Record<string, string> : undefined,
      fields: (body.fields && typeof body.fields === "object") ? body.fields as Record<string, string> : undefined,
      guild_id: typeof body.guild_id === "string" ? body.guild_id : undefined,
      channel_id: typeof body.channel_id === "string" ? body.channel_id : undefined,
    };
    try {
      const response = customId.startsWith(GCL)
        ? await handleClaimComponent(ev)
        : { type: 4, data: { content: "That button isn't recognised.", flags: 64, allowed_mentions: { parse: [] } } };
      return { status: 200, response };
    } catch (err) {
      console.error("discord component:", (err as Error).message);
      return { status: 200, response: { type: 4, data: { content: `Something went wrong closing that action: ${(err as Error).message}. Please try again.`, flags: 64, allowed_mentions: { parse: [] } } } };
    }
  }
  if (body.type === "link") {
    const code = String(body.code || "").toUpperCase();
    const { data } = await getDb().from("ghostchat_live_channels").select("*").eq("kind", "discord").eq("link_code", code).maybeSingle();
    const ch = data as (ChannelRow & { link_expires_at: string | null }) | null;
    if (!ch || (ch.link_expires_at && Date.parse(ch.link_expires_at) < Date.now())) return { status: 200, reply: "That link code isn't valid any more. Make a new one in GhostChat › Live chat." };
    await getDb().from("ghostchat_live_channels").update({
      status: "connected", link_code: null, link_expires_at: null, updated_at: new Date().toISOString(),
      config: { guild_id: String(body.guild_id || ""), guild_name: String(body.guild_name || ""), channel_id: String(body.channel_id || ""), channel_name: String(body.channel_name || "") },
    }).eq("id", ch.id);
    return { status: 200, reply: "✅ Linked to GhostChat. New live chats will post a ticket card in this channel, and claimed chats will continue in your DMs." };
  }
  if (body.type === "message") {
    const channelId = String(body.thread_id || body.channel_id || "");
    const content = String(body.content || "").trim();
    const authorId = String(body.author_id || "");
    if (!channelId || !content) return { status: 200, ignored: true };
    const conv = await conversationForAgentChannel(channelId, authorId);
    if (!conv) return { status: 200, ignored: true };
    if (/^!(?:back)\b/i.test(content)) {
      const ended = await endLiveChat(conv, "discord", "handback");
      if (ended.discordArchive && !ended.discordArchive.ok) return { status: 200, reply: `🤖 Handed back to the AI, but I couldn't finish closing the Discord side. ${ended.discordArchive.error || ""}`.trim() };
      return { status: 200, reply: "🤖 Handed back to the AI assistant. The visitor can leave a review." };
    }
    if (/^!(?:close|end)\b/i.test(content)) {
      const ended = await endLiveChat(conv, "discord", "end");
      if (ended.discordArchive && !ended.discordArchive.ok) return { status: 200, reply: `✅ Chat closed in GhostChat, but I couldn't finish closing the Discord side. ${ended.discordArchive.error || ""}`.trim() };
      return { status: 200, reply: "✅ Chat closed. The visitor can leave a review." };
    }
    const name = typeof body.author_name === "string" ? supportName(body.author_name) : null;
    if (/^!take\b/i.test(content)) { await takeOver(conv, name || conv.claimed_by_name); return { status: 200, reply: "🧑 You have the chat. The AI will stay quiet." }; }
    if (conv.status === "bot" || conv.status === "closed") return { status: 200, reply: "This chat was handed back to the AI. Type `!take` to jump back in, or claim the ticket card again." };
    const confirm = await deliverAgentReply(conv, content, (conv.claimed_by_id && conv.claimed_by_id === authorId ? conv.claimed_by_name : name) || "Team", authorId);
    return { status: 200, reply: confirm || undefined };
  }
  return { status: 400 };
}

export const discordWebhookRouter = Router();
discordWebhookRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!verifyDiscordRelay(req.header("x-ghostchat-timestamp"), req.header("x-ghostchat-signature"), raw)) return res.status(401).json({ error: "bad signature" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return res.status(400).end(); }
  try {
    const out = await handleDiscordRelay(body);
    res.status(out.status).json({ ok: out.status === 200, reply: out.reply ?? null, response: out.response ?? null, ignored: out.ignored ?? false });
  } catch (err) {
    console.error("discord relay:", (err as Error).message);
    res.status(200).json({ ok: false, response: { type: 4, data: { content: `Something went wrong: ${(err as Error).message}. Please try again.`, flags: 64, allowed_mentions: { parse: [] } } } });
  }
});

export { agentNameFor };
