import { Router } from "express";
import { workspaceId, denyIfNotOwner } from "../lib/auth.js";
import { buildDigest, latestDigest } from "../lib/digest.js";
import { canUseDigest } from "../lib/team.js";
import { getOwnerPlan } from "../lib/usage.js";
import { getDb } from "../lib/supabase.js";
import { mailerConfigured } from "../lib/mailer.js";

export const digestRouter = Router();

digestRouter.get("/", async (req, res) => {
  const ws = workspaceId(req);
  const plan = await getOwnerPlan(ws);
  const { data: owner } = await getDb().from("ghostchat_owners").select("digest_opt_in, name, email").eq("id", ws).maybeSingle();
  const payload = canUseDigest(plan) ? await buildDigest(ws).catch(() => null) : null;
  const last = await latestDigest(ws).catch(() => null);
  res.json({
    allowed: canUseDigest(plan),
    optIn: Boolean(owner?.digest_opt_in),
    mailer: mailerConfigured(),
    current: payload,
    last,
  });
});

digestRouter.post("/opt-in", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  const ws = workspaceId(req);
  const plan = await getOwnerPlan(ws);
  if (!canUseDigest(plan)) return res.status(402).json({ error: "Weekly digests are on Pro and Business." });
  const on = Boolean(req.body?.optIn ?? req.body?.enabled ?? true);
  await getDb().from("ghostchat_owners").update({ digest_opt_in: on, updated_at: new Date().toISOString() }).eq("id", ws);
  res.json({ ok: true, optIn: on, mailer: mailerConfigured() });
});
