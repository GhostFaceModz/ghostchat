import { Router } from "express";
import { denyIfNotOwner, denyIfViewer, workspaceId } from "../lib/auth.js";
import { getDb } from "../lib/supabase.js";
import { acceptInbound, disableEmailChannel, enableEmailChannel, getThread, inboundAddress, inboundWebhookUrl, listThreads, loadSiteByInboundToken, parseInbound, sendThreadReply } from "../lib/emailChannel.js";
import { canUseEmailChannel, canUseCopilot } from "../lib/team.js";
import { suggestEmailReply, suggestInboxReply } from "../lib/copilot.js";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import type { Site } from "../types.js";
import type { Plan } from "../config.js";

async function loadOwned(req: Parameters<typeof workspaceId>[0], id: string): Promise<Site | null> {
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", id).eq("owner_id", workspaceId(req)).maybeSingle();
  return (data as Site) ?? null;
}

export const emailOwnerRouter = Router();

emailOwnerRouter.get("/:id/email-channel", async (req, res) => {
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const enabled = Boolean(site.email_channel && site.email_inbound_token);
  res.json({
    allowed: canUseEmailChannel(site.plan as Plan),
    enabled,
    token: enabled ? site.email_inbound_token : null,
    webhookUrl: enabled && site.email_inbound_token ? inboundWebhookUrl(site.email_inbound_token) : null,
    address: enabled && site.email_inbound_token ? inboundAddress(site.email_inbound_token) : null,
    threads: enabled ? await listThreads(site.id) : [],
  });
});

emailOwnerRouter.post("/:id/email-channel", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  try {
    const enabled = await enableEmailChannel(site);
    res.json({ ok: true, enabled: true, ...enabled });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 500).json({ error: e.message || "Could not enable the email channel." });
  }
});

emailOwnerRouter.delete("/:id/email-channel", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  await disableEmailChannel(site.id);
  res.json({ ok: true, enabled: false });
});

emailOwnerRouter.get("/:id/email-channel/threads/:tid", async (req, res) => {
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const packed = await getThread(site.id, req.params.tid);
  if (!packed) return res.status(404).json({ error: "Thread not found." });
  res.json(packed);
});

emailOwnerRouter.post("/:id/email-channel/threads/:tid/reply", async (req, res) => {
  if (denyIfViewer(req, res)) return;
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const text = String(req.body?.text || req.body?.body || "").trim();
  if (!text) return res.status(400).json({ error: "Write a reply first." });
  const result = await sendThreadReply(site, req.params.tid, text, typeof req.body?.agentName === "string" ? req.body.agentName : undefined);
  res.status(result.ok ? 200 : 503).json(result);
});

emailOwnerRouter.post("/:id/email-channel/threads/:tid/suggest", async (req, res) => {
  if (denyIfViewer(req, res)) return;
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  if (!canUseCopilot(site.plan as Plan)) return res.status(402).json({ error: "Inbox copilot is a Business feature." });
  const packed = await getThread(site.id, req.params.tid);
  if (!packed) return res.status(404).json({ error: "Thread not found." });
  const lastIn = [...packed.messages].reverse().find((m: { direction: string; body: string }) => m.direction === "in");
  const suggestion = await suggestEmailReply(site, lastIn?.body || "", packed.thread.subject as string);
  res.json({ suggestion });
});

emailOwnerRouter.post("/:id/inbox/suggest", async (req, res) => {
  if (denyIfViewer(req, res)) return;
  const site = await loadOwned(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  if (!canUseCopilot(site.plan as Plan)) return res.status(402).json({ error: "Inbox copilot is a Business feature." });
  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ error: "A session is required." });
  const suggestion = await suggestInboxReply(site, sessionId);
  res.json({ suggestion });
});

export const emailInboundRouter = Router();

emailInboundRouter.post("/:token", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`email-in:${ip}`, 30, 3_600_000);
  if (!rl.ok) return res.status(429).json({ error: "Too many inbound emails from this address." });
  const site = await loadSiteByInboundToken(req.params.token);
  if (!site) return res.status(404).json({ error: "Unknown inbound address." });
  const mail = parseInbound((req.body || {}) as Record<string, unknown>);
  if (!mail) return res.status(400).json({ error: "from and text are required." });
  try {
    const accepted = await acceptInbound(site, mail);
    res.json({ ok: true, threadId: accepted.threadId });
  } catch (err) {
    console.error("inbound email failed:", (err as Error).message);
    res.status(500).json({ error: "Could not accept that email." });
  }
});
