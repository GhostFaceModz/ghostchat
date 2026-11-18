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
import { loadAutoRecharge, saveAutoRecharge, recordAutoRechargeSpend, latestRechargePrompt, packCheckoutUrl } from "../lib/autoRecharge.js";
import { deleteOwnerKey, isByokPlan, listOwnerKeys, upsertOwnerKey, byokConfigured } from "../lib/byok.js";
import type { ProviderId } from "../lib/models.js";

export const billingRouter = Router();

/** One-time message packs on Whop (prices exclude VAT). */
export const TOPUPS = [
  { id: config.whopTopup1000Id, messages: 1000, price: 5 },
  { id: config.whopTopup5000Id, messages: 5000, price: 15 },
];
export function topupFor(planId?: string | null) {
  return planId ? TOPUPS.find((t) => t.id === planId) ?? null : null;
}

/** Credit an account once per Whop payment. Returns false when this payment was already credited. */
export async function grantTopup(ownerId: string, paymentId: string, planId: string, messages: number): Promise<boolean> {
  const db = getDb();
  const { error } = await db.from("ghostchat_credit_grants").insert({ owner_id: ownerId, whop_payment_id: paymentId, plan_id: planId, credits: messages });
  if (error) {
    if ((error as { code?: string }).code === "23505") return false; // already granted
    throw error;
  }
  const { error: e2 } = await db.rpc("ghostchat_add_credits", { p_owner: ownerId, p_delta: messages });
  if (e2) throw e2;
  const price = messages >= 5000 ? 15 : 5;
  await recordAutoRechargeSpend(ownerId, price).catch(() => {});
  await db.from("ghostchat_auto_recharge_events").update({ status: "granted" }).eq("owner_id", ownerId).in("status", ["needed", "prompted"]).eq("pack", messages);
  return true;
}
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
        proYearly: config.whopCheckoutProYearlyUrl || null,
        businessYearly: config.whopCheckoutBusinessYearlyUrl || null,
      },
      prices: {
        proMonthly: 9,
        businessMonthly: 29,
        proYearly: 90,
        businessYearly: 290,
        yearlySaving: "two months free",
      },
      credits: Number((await getDb().from("ghostchat_owners").select("message_credits").eq("id", owner.id).maybeSingle()).data?.message_credits ?? 0),
      topups: TOPUPS.map((t) => ({ id: t.id, messages: t.messages, price: t.price, url: `https://whop.com/checkout/${t.id}` })),
      autoRecharge: await loadAutoRecharge(owner.id).catch(() => null),
      autoRechargePrompt: plan !== "free" ? await latestRechargePrompt(owner.id).catch(() => null) : null,
      byok: {
        allowed: isByokPlan(plan),
        configured: byokConfigured(),
        keys: isByokPlan(plan) ? await listOwnerKeys(owner.id).catch(() => []) : [],
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

  // Top-up packs: credit the account once per payment; never change the plan.
  const topup = topupFor(info.planId);
  if (topup) {
    let granted = false;
    if (ownerId && /payment\.succeeded|payment_succeeded|payment\.paid/i.test(event.type)) {
      granted = await grantTopup(ownerId, info.paymentId || eventId || `${info.membershipId}:${event.type}`, topup.id, topup.messages);
    }
    await db.from("ghostchat_billing_events").insert({
      owner_id: ownerId, event_type: event.type || "unknown", whop_event_id: eventId,
      payload: { type: event.type, email: info.email, planId: info.planId, paymentId: info.paymentId, topup: topup.messages, granted },
    });
    return res.json({ ok: true, topup: topup.messages, granted, ownerId });
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

billingRouter.post("/auto-recharge", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  if (!isByokPlan(plan)) return res.status(403).json({ error: "Auto-recharge is available on Pro and Business." });
  try {
    const body = req.body || {};
    const settings = await saveAutoRecharge(owner.id, {
      enabled: body.enabled === undefined ? undefined : body.enabled === true || body.enabled === "true" || body.enabled === "on",
      pack: body.pack === undefined ? undefined : (Number(body.pack) === 5000 ? 5000 : 1000),
      capGbp: body.capGbp === undefined && body.cap === undefined ? undefined : Number(body.capGbp ?? body.cap),
    });
    res.json({ settings, checkoutUrl: packCheckoutUrl(settings.pack) });
  } catch {
    res.status(500).json({ error: "Could not save auto-recharge settings." });
  }
});

billingRouter.get("/keys", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  if (!isByokPlan(plan)) return res.status(403).json({ error: "Bring-your-own-key is available on Pro and Business." });
  try {
    res.json({ keys: await listOwnerKeys(owner.id), configured: byokConfigured() });
  } catch {
    res.status(500).json({ error: "Could not load keys." });
  }
});

billingRouter.put("/keys", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  if (!isByokPlan(plan)) return res.status(403).json({ error: "Bring-your-own-key is available on Pro and Business." });
  const provider = String(req.body?.provider || "") as ProviderId;
  const key = String(req.body?.key || req.body?.apiKey || "");
  try {
    const saved = await upsertOwnerKey(owner.id, provider, key);
    // Never echo the key back.
    res.json({ key: saved });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message || "Could not save that key." });
  }
});

billingRouter.delete("/keys/:provider", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const plan = await getOwnerPlan(owner.id);
  if (!isByokPlan(plan)) return res.status(403).json({ error: "Bring-your-own-key is available on Pro and Business." });
  try {
    await deleteOwnerKey(owner.id, String(req.params.provider) as ProviderId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not remove that key." });
  }
});

