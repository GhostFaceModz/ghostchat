import { Router, type Request, type Response } from "express";
import { config, PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "../lib/supabase.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { applyOwnerPlan, getOwnerPlan, limitsFor } from "../lib/usage.js";
import {
  extractWhopBilling, isDowngradeEvent, isUpgradeEvent, parseWhopEvent, planFromWhopIds, verifyWhopSignature,
  whopApiConfigured, getMembership, cancelMembershipAtPeriodEnd, applyRetentionPromo, scheduleDowngradeToPro,
  WHOP_MANAGE_URL, type MembershipInfo,
} from "../lib/whop.js";

export const billingRouter = Router();
export const whopWebhookRouter = Router();

billingRouter.get("/", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  const { data } = await getDb()
    .from("ghostchat_owners")
    .select("whop_membership_id, plan, is_admin")
    .eq("id", owner.id)
    .maybeSingle();
  let membership: (MembershipInfo & { source: string }) | null = null;
  if (data?.whop_membership_id) {
    membership = { id: data.whop_membership_id, status: null, cancel_at_period_end: false, renewal_period_end: null, plan_id: null, promo_applied: false, source: "local" };
    if (whopApiConfigured()) {
      try { membership = { ...(await getMembership(data.whop_membership_id)), source: "whop" }; } catch { /* show what we know */ }
    }
  }
  res.json({
    billing: {
      plan,
      membership,
      manageUrl: WHOP_MANAGE_URL,
      canCancelInApp: whopApiConfigured(),
      retention: {
        discount: Boolean(membership && !membership.promo_applied),
        downgrade: plan === "business" && Boolean(membership),
      },
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
    if (info.metadataPlan) plan = info.metadataPlan;
  } else if (isDowngradeEvent(event.type)) {
    plan = "free";
  }

  // Ignore the end of an old membership when the owner already has a different, newer one.
  if (plan === "free" && ownerId && info.membershipId) {
    const { data: cur } = await db.from("ghostchat_owners").select("whop_membership_id").eq("id", ownerId).maybeSingle();
    if (cur?.whop_membership_id && cur.whop_membership_id !== info.membershipId) plan = null;
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

// ---- Cancel flow: retention offer, optional reason, confirm ----
async function ownerBilling(ownerId: string) {
  const { data } = await getDb().from("ghostchat_owners").select("plan, whop_membership_id, is_admin").eq("id", ownerId).maybeSingle();
  return data as { plan: Plan; whop_membership_id: string | null; is_admin: boolean } | null;
}

async function logCancellation(row: Record<string, unknown>) {
  await getDb().from("ghostchat_cancellations").insert(row);
}

const REASONS = new Set(["too_expensive", "not_using", "missing_features", "answers_quality", "switching", "temporary", "other"]);

billingRouter.post("/cancel", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const b = await ownerBilling(owner.id);
  if (!b || b.plan === "free" || !b.whop_membership_id) return res.status(400).json({ error: "There's no paid subscription on this account." });
  const reasonRaw = String(req.body?.reason || "");
  const reason = REASONS.has(reasonRaw) ? reasonRaw : null;
  const details = String(req.body?.details || "").trim().slice(0, 500) || null;
  const base = { owner_id: owner.id, plan: b.plan, membership_id: b.whop_membership_id, reason, details };

  if (whopApiConfigured()) {
    try {
      const m = await cancelMembershipAtPeriodEnd(b.whop_membership_id);
      await logCancellation({ ...base, outcome: "cancelled", access_ends_at: m.renewal_period_end });
      const when = m.renewal_period_end ? new Date(m.renewal_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : null;
      return res.json({
        ok: true, cancelled: true, accessEndsAt: m.renewal_period_end,
        message: when ? `Your subscription is cancelled. You won't be charged again, and you keep ${b.plan === "business" ? "Business" : "Pro"} until ${when}.` : "Your subscription is cancelled. You won't be charged again.",
      });
    } catch (e) {
      await logCancellation({ ...base, outcome: "error", error: (e as Error).message.slice(0, 300) });
      // Fall through to Whop's own page so the customer is never stuck.
    }
  } else {
    await logCancellation({ ...base, outcome: "manage_page" });
  }
  res.json({
    ok: true, cancelled: false, manageUrl: WHOP_MANAGE_URL,
    message: "We've opened your Whop orders page in a new tab. Choose GhostChat, then Cancel membership. You keep your plan until the end of the period you paid for.",
  });
});

billingRouter.post("/retention", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const offer = String(req.body?.offer || "");
  const b = await ownerBilling(owner.id);
  if (!b || b.plan === "free" || !b.whop_membership_id) return res.status(400).json({ error: "There's no paid subscription on this account." });
  if (offer !== "discount" && !(offer === "downgrade" && b.plan === "business")) return res.status(400).json({ error: "That offer isn't available." });
  const base = { owner_id: owner.id, plan: b.plan, membership_id: b.whop_membership_id, outcome: offer === "discount" ? "kept_discount" : "downgraded_pro" };
  if (!whopApiConfigured()) {
    await logCancellation({ ...base, outcome: base.outcome + "_manage_page" });
    return res.json({ ok: true, url: WHOP_MANAGE_URL, message: "Opened Whop in a new tab. Choose GhostChat, then Cancel membership: Whop shows the 50%-off offer there before anything is cancelled." });
  }
  try {
    if (offer === "discount") {
      await applyRetentionPromo(b.whop_membership_id);
      await logCancellation(base);
      return res.json({ ok: true, message: "Done! Your next month is 50% off. Thanks for staying." });
    }
    await scheduleDowngradeToPro(b.whop_membership_id, 9);
    await logCancellation(base);
    return res.json({ ok: true, message: "Done. You keep Business until your next renewal, then switch to Pro at £9/month + VAT." });
  } catch (e) {
    await logCancellation({ ...base, outcome: "error", error: (e as Error).message.slice(0, 300) });
    return res.status(502).json({ error: "Whop couldn't apply that just now: " + (e as Error).message });
  }
});
