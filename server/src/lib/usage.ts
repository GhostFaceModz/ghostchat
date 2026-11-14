import { PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";

function startOfUtcMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function refreshPeriod(site: Site): Promise<Site> {
  const start = startOfUtcMonth();
  if (new Date(site.period_start).toISOString() >= start) return site;
  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .update({
      messages_this_period: 0,
      leads_this_period: 0,
      usage_alert_level: 0,
      period_start: start,
      updated_at: new Date().toISOString(),
    })
    .eq("id", site.id)
    .select()
    .single();
  if (error) throw error;
  return data as Site;
}

export function effectiveBranding(site: Site): boolean {
  const limits = PLAN_LIMITS[site.plan as Plan] ?? PLAN_LIMITS.free;
  if (limits.brandingRequired) return true;
  return site.show_branding;
}

export function messageLimit(site: Site): number {
  return (PLAN_LIMITS[site.plan as Plan] ?? PLAN_LIMITS.free).monthlyMessages;
}

/** 10% grace over the monthly allowance when there are no credits left. */
export const GRACE_RATIO = 0.1;
export const PAUSED_REPLY = "This assistant is taking a short break right now. Please check back a little later, or contact the site directly.";

export type SendDecision = { ok: boolean; reason: "allowance" | "credits" | "grace" | "paused" };
/** Allowance first, then the account's top-up credits, then 10% grace, then paused. */
export function decideSend(used: number, limit: number, credits: number): SendDecision {
  if (used < limit) return { ok: true, reason: "allowance" };
  if (credits > 0) return { ok: true, reason: "credits" };
  if (used < Math.floor(limit * (1 + GRACE_RATIO))) return { ok: true, reason: "grace" };
  return { ok: false, reason: "paused" };
}
export function alertLevel(used: number, limit: number): 0 | 80 | 100 {
  if (!limit) return 0;
  const pct = used / limit;
  return pct >= 1 ? 100 : pct >= 0.8 ? 80 : 0;
}

export async function ownerCredits(ownerId: string): Promise<number> {
  const { data } = await getDb().from("ghostchat_owners").select("message_credits").eq("id", ownerId).maybeSingle();
  return Number(data?.message_credits ?? 0);
}

export async function assertCanSend(site: Site): Promise<Site> {
  const fresh = await refreshPeriod(site);
  const limit = messageLimit(fresh);
  const credits = fresh.messages_this_period >= limit ? await ownerCredits(fresh.owner_id) : 0;
  if (!decideSend(fresh.messages_this_period, limit, credits).ok) {
    const err = new Error(PAUSED_REPLY);
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  return fresh;
}

export async function incrementMessages(siteId: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from("ghostchat_sites")
    .select("messages_this_period, owner_id, plan, usage_alert_level")
    .eq("id", siteId)
    .single();
  if (error) throw error;
  const used = (data?.messages_this_period ?? 0) + 1;
  const limit = messageLimit(data as unknown as Site);
  const level = alertLevel(used, limit);
  await db
    .from("ghostchat_sites")
    .update({
      messages_this_period: used,
      ...(level > (data?.usage_alert_level ?? 0) ? { usage_alert_level: level } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
  // Past the allowance, each message uses one top-up credit (if any; otherwise it's within the grace).
  if (used > limit && data?.owner_id) {
    await db.rpc("ghostchat_use_credit", { p_owner: data.owner_id });
  }
}

export async function incrementLeads(siteId: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from("ghostchat_sites")
    .select("leads_this_period")
    .eq("id", siteId)
    .single();
  if (error) throw error;
  await db
    .from("ghostchat_sites")
    .update({
      leads_this_period: (data?.leads_this_period ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
}

export async function countOwnerSites(ownerId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("ghostchat_sites")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  if (error) throw error;
  return count ?? 0;
}

export async function countUploads(siteId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("ghostchat_documents")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .in("source_type", ["upload", "paste", "pdf", "notion"]);
  if (error) throw error;
  return count ?? 0;
}

export function limitsFor(plan: Plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export function leadsLimit(site: Site): number {
  return limitsFor(site.plan as Plan).monthlyLeads;
}

export function analyticsLevel(site: Site): "basic" | "full" {
  return limitsFor(site.plan as Plan).analytics;
}

export function maxCards(site: Site): number {
  return limitsFor(site.plan as Plan).maxCards;
}

export async function assertCanCaptureLead(site: Site): Promise<Site> {
  const fresh = await refreshPeriod(site);
  if (fresh.leads_this_period >= leadsLimit(fresh)) {
    const err = new Error("This site has reached its monthly lead-capture limit. Upgrade to keep collecting emails.");
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  return fresh;
}

export async function applyOwnerPlan(ownerId: string, plan: Plan, extra?: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  // Admin (house) accounts stay on Business no matter what billing events say.
  const { data: current } = await db.from("ghostchat_owners").select("is_admin").eq("id", ownerId).maybeSingle();
  if (current?.is_admin) plan = "business";
  const { error: ownerErr } = await db
    .from("ghostchat_owners")
    .update({ plan, updated_at: now, ...(extra || {}) })
    .eq("id", ownerId);
  if (ownerErr) throw ownerErr;
  const { error: siteErr } = await db
    .from("ghostchat_sites")
    .update({ plan, updated_at: now })
    .eq("owner_id", ownerId);
  if (siteErr) throw siteErr;
}

export async function getOwnerPlan(ownerId: string): Promise<Plan> {
  const { data, error } = await getDb().from("ghostchat_owners").select("plan").eq("id", ownerId).maybeSingle();
  if (error) throw error;
  const plan = data?.plan as Plan | undefined;
  return plan && plan in PLAN_LIMITS ? plan : "free";
}

// ---- Per-site daily cap (in memory): a tenth of the monthly allowance per day, at least 25. ----
const dailyCounts = new Map<string, number>();
export function dailyCap(site: Site): number {
  return Math.max(25, Math.ceil(messageLimit(site) / 10));
}
export function dailyCapCheck(site: Site, now = new Date()): { ok: boolean; used: number; cap: number } {
  const day = now.toISOString().slice(0, 10);
  const key = `${site.id}:${day}`;
  if (dailyCounts.size > 5000) for (const k of dailyCounts.keys()) if (!k.endsWith(day)) dailyCounts.delete(k);
  const used = dailyCounts.get(key) ?? 0;
  const cap = dailyCap(site);
  if (used >= cap) return { ok: false, used, cap };
  dailyCounts.set(key, used + 1);
  return { ok: true, used: used + 1, cap };
}
