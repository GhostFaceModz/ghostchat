import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { answerQuestion, streamAnswer } from "../lib/chat.js";
import { clientIp, rateLimit } from "../lib/rateLimit.js";
import { assertCanSend } from "../lib/usage.js";
import type { Site } from "../types.js";

export const chatRouter = Router();

async function loadSiteByKey(siteKey: string): Promise<Site | null> {
  const key = String(siteKey || "").trim();
  if (!key.startsWith("gc_")) return null;
  const { data, error } = await getDb().from("ghostchat_sites").select("*").eq("site_key", key).maybeSingle();
  if (error) throw error;
  return (data as Site) ?? null;
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
  const rl = rateLimit(`chat:${siteKey}:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.ok) {
    res.setHeader("retry-after", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res.status(429).json({ error: "You're sending messages a little too quickly. Please wait a moment." });
  }

  const site = await loadSiteByKey(siteKey);
  if (!site) return res.status(404).json({ error: "Unknown site key." });

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
      await streamAnswer({ site, message, sessionId, pageUrl, onEvent: send });
    } catch (err) {
      send({ type: "error", error: (err as Error).message || "The assistant could not reply just now." });
    }
    res.end();
    return;
  }

  try {
    const outcome = await answerQuestion({ site, message, sessionId, pageUrl });
    res.json(outcome);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || "The assistant could not reply just now." });
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
