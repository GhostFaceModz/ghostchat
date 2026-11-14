import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { answerQuestion, streamAnswer } from "../lib/chat.js";
import { clientIp, rateLimit, peekRateLimit } from "../lib/rateLimit.js";
import { assertCanSend, dailyCapCheck } from "../lib/usage.js";
import { addLog, countUnsure, getConversation, shouldStartLive, liveOnline, liveSettings, handoffTimedOut } from "../lib/live.js";
import { applyTimeout } from "../lib/discordClaim.js";
import { agentNameFor, startHandoff, visitorLiveMessage } from "../lib/handoff.js";
import { HUMAN_REQUEST } from "../lib/guardrails.js";
import type { Site } from "../types.js";

export const chatRouter = Router();

async function loadSiteByKey(siteKey: string): Promise<Site | null> {
  const key = String(siteKey || "").trim();
  if (!key.startsWith("gc_")) return null;
  const { data, error } = await getDb().from("ghostchat_sites").select("*").eq("site_key", key).maybeSingle();
  if (error) throw error;
  return (data as Site) ?? null;
}

/** Per visitor (session) and per IP: 6 messages a minute and 60 an hour. In memory. */
export function chatRateLimit(ip: string, siteKey: string, sessionId: string): { message: string; retryAfterSec: number } | null {
  const checks: Array<[string, number, number]> = [
    [`chat:ip:m:${ip}`, 6, 60_000],
    [`chat:ip:h:${ip}`, 60, 3_600_000],
    [`chat:sid:m:${siteKey}:${sessionId}`, 6, 60_000],
    [`chat:sid:h:${siteKey}:${sessionId}`, 60, 3_600_000],
  ];
  for (const [key, limit, windowMs] of checks) {
    const rl = peekRateLimit(key, limit, windowMs);
    if (!rl.ok) {
      const sec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      const wait = sec >= 120 ? `${Math.ceil(sec / 60)} minutes` : `${sec} seconds`;
      return { message: `Whoa, that's a lot of messages! Please slow down a little and try again in ${wait}.`, retryAfterSec: sec };
    }
  }
  for (const [key, limit, windowMs] of checks) rateLimit(key, limit, windowMs);
  return null;
}

chatRouter.post("/", async (req, res) => {
  const siteKey = String(req.body?.siteKey || req.body?.site_key || "");
  const message = String(req.body?.message || "").trim();
  const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim() || "anon";
  const pageUrl = typeof req.body?.pageUrl === "string" ? req.body.pageUrl.slice(0, 500) : null;
  const wantStream = req.body?.stream !== false && String(req.query.stream || "1") !== "0";

  if (!message) return res.status(400).json({ error: "A message is required." });
  if (message.length > 2000) return res.status(400).json({ error: "That message is too long." });
  if (sessionId.length > 80) return res.status(400).json({ error: "Invalid session." });

  const ip = clientIp(req);
  const limited = chatRateLimit(ip, siteKey, sessionId);
  if (limited) {
    res.setHeader("retry-after", String(limited.retryAfterSec));
    return res.status(429).json({ error: limited.message, retryAfter: limited.retryAfterSec });
  }

  const site = await loadSiteByKey(siteKey);
  if (!site) return res.status(404).json({ error: "Unknown site key." });

  // Live chat: while a human has (or is joining) the conversation the AI stays silent and nothing is charged.
  let conv = await getConversation(site.id, sessionId).catch(() => null);
  if (conv && handoffTimedOut(conv, liveSettings(site))) {
    // Nobody picked it up in time: let the AI carry on rather than leaving the visitor hanging.
    await applyTimeout(site, conv);
    conv = null;
  }
  if (conv && (conv.status === "waiting" || conv.status === "human")) {
    await visitorLiveMessage(site, conv, message, pageUrl);
    const live = { type: "live", status: conv.status, agentName: conv.agent_name };
    if (!wantStream) return res.json({ live, answer: null });
    res.status(200).setHeader("content-type", "text/event-stream; charset=utf-8");
    res.write(`data: ${JSON.stringify(live)}\n\n`);
    return res.end();
  }
  if (HUMAN_REQUEST.test(message) && shouldStartLive(site, message, 0) === "asked") {
    await addLog({ site_id: site.id, session_id: sessionId, role: "user", message, page_url: pageUrl });
    const started = await startHandoff(site, sessionId, "asked", pageUrl);
    const name = started.agent_name || (await agentNameFor(site));
    const live = { type: "live", status: "waiting", agentName: name, note: `I've asked the team to join. Waiting for a team member… you can keep typing here.` };
    if (!wantStream) return res.json({ live, answer: null });
    res.status(200).setHeader("content-type", "text/event-stream; charset=utf-8");
    res.write(`data: ${JSON.stringify(live)}\n\n`);
    return res.end();
  }

  const daily = dailyCapCheck(site);
  if (!daily.ok) {
    return res.status(429).json({ error: "This assistant has had a very busy day and is taking a break. Please try again tomorrow." });
  }

  try {
    await assertCanSend(site);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    return res.status(status).json({ error: (err as Error).message });
  }

  if (wantStream) {
    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();
    const send = (event: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const outcome = await streamAnswer({ site, message, sessionId, pageUrl, onEvent: send });
      if (outcome.unsure && liveOnline(site)) {
        const reason = shouldStartLive(site, message, await countUnsure(site.id, sessionId));
        if (reason) {
          const started = await startHandoff(site, sessionId, reason, pageUrl);
          const name = started.agent_name || (await agentNameFor(site));
          send({ type: "live", status: "waiting", agentName: name, note: `I couldn't find that, so I've asked the team to join. Waiting for a team member…` });
        }
      }
    } catch (err) {
      console.error("chat route failed:", (err as Error).message);
      send({ type: "error", error: "Sorry, I'm having trouble replying right now. Please try again in a minute." });
    }
    res.end();
    return;
  }

  try {
    const outcome = await answerQuestion({ site, message, sessionId, pageUrl });
    let live: Record<string, unknown> | undefined;
    if (outcome.unsure && liveOnline(site)) {
      const reason = shouldStartLive(site, message, await countUnsure(site.id, sessionId));
      if (reason) {
        const started = await startHandoff(site, sessionId, reason, pageUrl);
        live = { type: "live", status: "waiting", agentName: started.agent_name };
      }
    }
    res.json(live ? { ...outcome, live } : outcome);
  } catch (err) {
    console.error("chat route failed:", (err as Error).message);
    res.status(500).json({ error: "Sorry, I'm having trouble replying right now. Please try again in a minute." });
  }
});

chatRouter.post("/feedback", async (req, res) => {
  const siteKey = String(req.body?.siteKey || "");
  const logId = String(req.body?.logId || req.body?.assistantLogId || "");
  const rating = String(req.body?.rating || req.body?.feedback || "");
  if (rating !== "up" && rating !== "down") return res.status(400).json({ error: "Rating must be up or down." });
  const site = await loadSiteByKey(siteKey);
  if (!site) return res.status(404).json({ error: "Unknown site key." });
  const { data, error } = await getDb()
    .from("ghostchat_logs")
    .update({ feedback: rating })
    .eq("id", logId)
    .eq("site_id", site.id)
    .eq("role", "assistant")
    .select("id")
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Could not save feedback." });
  if (!data) return res.status(404).json({ error: "Message not found." });
  res.json({ ok: true });
});
