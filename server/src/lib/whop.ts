import { createHmac, timingSafeEqual } from "node:crypto";
import { config, type Plan } from "../config.js";

export function verifyWhopSignature(opts: {
  rawBody: string | Buffer;
  id?: string | string[];
  timestamp?: string | string[];
  signature?: string | string[];
  secret?: string;
  now?: number;
}): boolean {
  const secret = opts.secret ?? config.whopWebhookSecret;
  const id = Array.isArray(opts.id) ? opts.id[0] : opts.id;
  const timestamp = Array.isArray(opts.timestamp) ? opts.timestamp[0] : opts.timestamp;
  const signature = Array.isArray(opts.signature) ? opts.signature[0] : opts.signature;
  if (!secret || !id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60) return false;

  const body = Buffer.isBuffer(opts.rawBody) ? opts.rawBody.toString("utf8") : opts.rawBody;
  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  const candidates = signature.split(" ").flatMap((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith("v1,")) return [trimmed.slice(3)];
    return trimmed ? [trimmed] : [];
  });
  const expectedBuf = Buffer.from(expected);
  return candidates.some((cand) => {
    const got = Buffer.from(cand);
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
  });
}

export type WhopEvent = {
  type: string;
  id?: string;
  data: Record<string, unknown>;
};

export function parseWhopEvent(raw: string): WhopEvent {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const type = String(json.type || json.event || "");
  const data = (json.data && typeof json.data === "object" ? json.data : json) as Record<string, unknown>;
  const id = json.id ? String(json.id) : undefined;
  return { type, id, data };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function extractWhopBilling(event: WhopEvent): {
  email: string | null;
  membershipId: string | null;
  customerId: string | null;
  planId: string | null;
  productId: string | null;
  metadataOwnerId: string | null;
  metadataPlan: Plan | null;
  paymentId: string | null;
} {
  const data = event.data;
  const user = asRecord(data.user) || asRecord(data.member) || asRecord(data.customer);
  const plan = asRecord(data.plan);
  const product = asRecord(data.product);
  const membership = asRecord(data.membership) || data;
  const metadata = asRecord(data.metadata) || asRecord(membership.metadata);
  const emailRaw = user?.email || data.email;
  return {
    email: typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : null,
    membershipId:
      typeof data.membership === "string" ? data.membership
      : typeof data.membership_id === "string" ? data.membership_id
      : membership && typeof membership.id === "string" ? membership.id
      : typeof data.id === "string" ? data.id : null,
    customerId:
      (user && typeof user.id === "string" && user.id) ||
      (typeof data.user_id === "string" ? data.user_id : null),
    planId: (plan && typeof plan.id === "string" && plan.id) || (typeof data.plan_id === "string" ? data.plan_id : null),
    productId: (product && typeof product.id === "string" && product.id) || (typeof data.product_id === "string" ? data.product_id : null),
    metadataOwnerId:
      metadata && typeof metadata.ghostchat_owner_id === "string" ? metadata.ghostchat_owner_id
      : metadata && typeof metadata.owner_id === "string" ? metadata.owner_id : null,
    // Set on a membership when the customer switches Business -> Pro from the cancel flow.
    paymentId: typeof data.id === "string" && /^pay_/.test(data.id) ? data.id : typeof data.payment_id === "string" ? data.payment_id : null,
    metadataPlan: metadata && (metadata.ghostchat_plan === "pro" || metadata.ghostchat_plan === "business") ? (metadata.ghostchat_plan as Plan) : null,
  };
}

export function planFromWhopIds(planId?: string | null, productId?: string | null): Plan | null {
  const ids = [planId, productId].filter(Boolean) as string[];
  if (!ids.length) return null;
  if (config.whopPlanBusinessId && ids.includes(config.whopPlanBusinessId)) return "business";
  if (config.whopPlanProId && ids.includes(config.whopPlanProId)) return "pro";
  return null;
}

export function isUpgradeEvent(type: string): boolean {
  return /went_valid|activated|payment\.succeeded|membership\.created/i.test(type);
}

export function isDowngradeEvent(type: string): boolean {
  return /went_invalid|deactivated|cancelled|canceled|expired/i.test(type) && !/cancel_at_period_end/i.test(type);
}

// ---- Whop REST API (needs WHOP_API_KEY with membership read/cancel/update permissions) ----
const WHOP_API = "https://api.whop.com/api/v1";
export const WHOP_MANAGE_URL = "https://whop.com/@me/settings/orders/";
export const RETENTION_PROMO_CODE = process.env.WHOP_RETENTION_PROMO_CODE || "GCSTAY50";

export function whopApiConfigured(): boolean {
  return Boolean(config.whopApiKey);
}

async function whopApi<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(WHOP_API + path, {
    method,
    headers: { authorization: `Bearer ${config.whopApiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = asRecord(json.error);
    throw new Error((err && typeof err.message === "string" && err.message) || (typeof json.message === "string" && json.message) || `Whop API ${res.status}`);
  }
  return json as T;
}

export type MembershipInfo = {
  id: string;
  status: string | null;
  cancel_at_period_end: boolean;
  renewal_period_end: string | null;
  plan_id: string | null;
  promo_applied: boolean;
};

function toMembershipInfo(m: Record<string, unknown>): MembershipInfo {
  const plan = asRecord(m.plan) || asRecord(m.variant);
  const end = m.renewal_period_end ?? m.current_period_end ?? m.expires_at ?? null;
  const endIso = typeof end === "number" ? new Date(end * 1000).toISOString() : typeof end === "string" ? end : null;
  return {
    id: String(m.id || ""),
    status: typeof m.status === "string" ? m.status : null,
    cancel_at_period_end: Boolean(m.cancel_at_period_end),
    renewal_period_end: endIso,
    plan_id: (plan && typeof plan.id === "string" && plan.id) || (typeof m.plan_id === "string" ? m.plan_id : null),
    promo_applied: Boolean(m.promo_code),
  };
}

export async function getMembership(id: string): Promise<MembershipInfo> {
  return toMembershipInfo(await whopApi("GET", `/memberships/${encodeURIComponent(id)}`));
}
export async function cancelMembershipAtPeriodEnd(id: string): Promise<MembershipInfo> {
  return toMembershipInfo(await whopApi("POST", `/memberships/${encodeURIComponent(id)}/cancel`, { cancellation_mode: "at_period_end" }));
}
export async function applyRetentionPromo(id: string): Promise<void> {
  await whopApi("POST", `/memberships/${encodeURIComponent(id)}/apply_promo_code`, { promo_code: RETENTION_PROMO_CODE });
}
export async function scheduleDowngradeToPro(id: string, proPrice: number): Promise<MembershipInfo> {
  // Lower the renewal price first (Whop allows only one field per update), then tag the plan.
  await whopApi("PATCH", `/memberships/${encodeURIComponent(id)}`, { renewal_price: proPrice });
  return toMembershipInfo(await whopApi("PATCH", `/memberships/${encodeURIComponent(id)}`, { metadata: { ghostchat_plan: "pro" } }));
}
