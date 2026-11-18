import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { answerQuestion } from "../lib/chat.js";
import { assertCanSend } from "../lib/usage.js";
import { rateLimitAsync } from "../lib/rateLimit.js";
import { channelActive, extractMetaMessages, metaEnabled, sendMetaReply, verifyChallenge, verifyMetaSignature, type MetaMessage } from "../lib/meta.js";
import type { Site } from "../types.js";

/** Meta Cloud API webhook (WhatsApp + Instagram DMs). Mounted with express.raw so the signature can be checked. OFF by default. */
export const metaWebhookRouter = Router();

metaWebhookRouter.get("/", (req, res) => {
  const challenge = verifyChallenge(req.query as Record<string, unknown>);
  if (challenge === null) return res.sendStatus(403);
  res.type("text/plain").send(challenge);
});

async function siteFor(msg: MetaMessage): Promise<Site | null> {
  const col = msg.channel === "whatsapp" ? "channels->whatsapp->>phone_number_id" : "channels->instagram->>account_id";
  if (!msg.accountId) return null;
  const { data } = await getDb().from("ghostchat_sites").select("*").eq(col, msg.accountId).limit(1).maybeSingle();
  return (data as Site) ?? null;
}

metaWebhookRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
  if (!metaEnabled()) return res.status(200).json({ ok: true, ignored: "WhatsApp/Instagram channels are switched off" });
  if (!verifyMetaSignature(raw, req.header("x-hub-signature-256"))) return res.sendStatus(401);
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return res.sendStatus(400); }
  res.status(200).json({ ok: true }); // Meta wants a fast 200; replies are sent asynchronously.
  for (const msg of extractMetaMessages(body)) {
    try {
      const site = await siteFor(msg);
      if (!site || !channelActive(site, msg.channel)) continue;
      if (!(await rateLimitAsync(`meta:${site.id}:${msg.from}`, 6, 60_000)).ok) continue;
      await assertCanSend(site);
      const out = await answerQuestion({ site, message: msg.text, sessionId: `${msg.channel === "whatsapp" ? "wa" : "ig"}_${msg.from}`.slice(0, 80) });
      await sendMetaReply(msg, out.answer + (out.sources[0]?.url ? `\n\n${out.sources[0].url}` : ""));
    } catch (err) {
      console.error(`meta ${msg.channel} reply failed:`, (err as Error).message);
    }
  }
});
