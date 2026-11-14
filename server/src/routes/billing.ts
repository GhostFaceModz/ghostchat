import { Router, type Request, type Response } from "express";
import { config, PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "../lib/supabase.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { applyOwnerPlan, getOwnerPlan, limitsFor } from "../lib/usage.js";
import { extractWhopBilling, isDowngradeEvent, isUpgradeEvent, parseWhopEvent, planFromWhopIds, verifyWhopSignature } from "../lib/whop.js";

export const billingRouter = Router();
export const whopWebhookRouter = Router();

billingRouter.get("/", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  const { data } = await getDb()
    .from("ghostchat_owners")
    .select("whop_membership_id, plan")
    .eq("id", owner.id)
    .maybeSingle();
  res.json({
    billing: {
      plan,
      limits: limitsFor(plan),
      configured: Boolean(config.whopWebhookSecret || config.whopCheckoutProUrl || config.whopCheckoutBusinessUrl),
      webhookUrl: `${config.publicUrl}/api/webhooks/whop`,
      membershipId: data?.whop_membership_id || null,
      checkout: {
        pro: config.whopCheckoutProUrl || null,
        business: config.whopCheckoutBusinessUrl || null,
      },
      plans: {
        free: PLAN_LIMITS.free,
        pro: PLAN_LIMITS.pro,
        business: PLAN_LIMITS.business,
      },
    },
  });
});

whopWebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!config.whopWebhookSecret) {
    return res.status(503).json({ error: "Whop is not configured. Set WHOP_WEBHOOK_SECRET." });
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
  const ok = verifyWhopSignature({
    rawBody: raw,
    id: req.header("webhook-id") || undefined,
    timestamp: req.header("webhook-timestamp") || undefined,
    signature: req.header("webhook-signature") || undefined,
  });
  if (!ok) return res.status(401).json({ error: "Invalid Whop signature." });

  let event;
  try {
    event = parseWhopEvent(raw);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }

  const info = extractWhopBilling(event);
  const eventId = event.id || req.header("webhook-id") || null;
  const db = getDb();

  if (eventId) {
    const { data: existing } = await db
      .from("ghostchat_billing_events")
      .select("id")
      .eq("whop_event_id", eventId)
      .maybeSingle();
    if (existing) return res.json({ ok: true, duplicate: true });
  }

  let ownerId: string | null = info.metadataOwnerId;
  if (!ownerId && info.email) {
    const { data: owner } = await db
      .from("ghostchat_owners")
      .select("id")
      .ilike("email", info.email)
      .maybeSingle();
    ownerId = owner?.id ?? null;
  }

  let plan: Plan | null = null;
  if (isUpgradeEvent(event.type)) {
    plan = planFromWhopIds(info.planId, info.productId) || "pro";
  } else if (isDowngradeEvent(event.type)) {
    plan = "free";
  }

  if (ownerId && plan) {
    await applyOwnerPlan(ownerId, plan, {
      whop_membership_id: plan === "free" ? null : info.membershipId,
      whop_customer_id: info.customerId,
    });
  }

  await db.from("ghostchat_billing_events").insert({
    owner_id: ownerId,
    event_type: event.type || "unknown",
    whop_event_id: eventId,
    payload: { type: event.type, email: info.email, planId: info.planId, productId: info.productId, membershipId: info.membershipId },
  });

  res.json({ ok: true, plan, ownerId });
});
