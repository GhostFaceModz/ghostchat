import { PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";
import { DEMO_SITE_KEY } from "./demoSite.js";
import { countStagingUploads } from "./staging.js";

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
export function decideSend(used: number, limit: number, credits: number, cost = 1): SendDecision {
  const c = Math.max(1, Math.floor(Number(cost)) || 1);
  if (used + c <= limit) return { ok: true, reason: "allowance" };
  const fromCredits = used >= limit ? c : used + c - limit;
  if (credits >= fromCredits) return { ok: true, reason: "credits" };
  if (used + c <= Math.floor(limit * (1 + GRACE_RATIO))) return { ok: true, reason: "grace" };
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

export async function assertCanSend(site: Site, cost = 1): Promise<Site> {
  const fresh = await refreshPeriod(site);
  const limit = messageLimit(fresh);
  const remaining = Math.max(0, limit - fresh.messages_this_period);
  const credits = remaining < Math.max(1, cost) ? await ownerCredits(fresh.owner_id) : 0;
  if (!decideSend(fresh.messages_this_period, limit, credits, cost).ok) {
    const err = new Error(PAUSED_REPLY);
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  return fresh;
}

export async function incrementMessages(siteId: string, cost = 1): Promise<void> {
  const db = getDb();
  const delta = Math.max(1, Math.floor(Number(cost)) || 1);
  const { data, error } = await db
    .from("ghostchat_sites")
    .select("owner_id, plan, messages_this_period")
    .eq("id", siteId)
    .single();
  if (error) throw error;
  const limit = messageLimit(data as unknown as Site);
  let usedRaw: unknown;
  let incErr: { message?: string } | null = null;
  const by = await db.rpc("ghostchat_increment_messages_by", { p_site: siteId, p_limit: limit, p_delta: delta });
  usedRaw = by.data;
  incErr = by.error;
  if (incErr) {
    const one = await db.rpc("ghostchat_increment_messages", { p_site: siteId, p_limit: limit });
    if (one.error) throw one.error;
    usedRaw = (Number(data?.messages_this_period ?? 0) + delta);
    for (let i = 1; i < delta; i++) {
      const more = await db.rpc("ghostchat_increment_messages", { p_site: siteId, p_limit: limit });
      if (more.error) throw more.error;
      usedRaw = more.data;
    }
    if (delta === 1) usedRaw = one.data;
  }
  const used = Number(usedRaw ?? (data?.messages_this_period ?? 0) + delta);
  const usedBefore = used - delta;
  const fromCredits = Math.max(0, used - limit) - Math.max(0, usedBefore - limit);
  if (fromCredits > 0 && data?.owner_id) {
    const usedMany = await db.rpc("ghostchat_use_credits", { p_owner: data.owner_id, p_n: fromCredits });
    if (usedMany.error) {
      for (let i = 0; i < fromCredits; i++) {
        await db.rpc("ghostchat_use_credit", { p_owner: data.owner_id });
      }
    }
  }
}

export async function incrementLeads(siteId: string): Promise<void> {
  const { error } = await getDb().rpc("ghostchat_increment_leads", { p_site: siteId });
  if (error) throw error;
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
    .in("source_type", ["upload", "paste", "pdf", "notion"])
    .is("deleted_at", null);
  if (error) throw error;
  const staged = await countStagingUploads(siteId).catch(() => 0);
  return (count ?? 0) + staged;
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

// ---- Per-site daily cap: a tenth of the monthly allowance per day, at least 25. ----
const dailyCounts = new Map<string, number>();
/** Official ghostchat.pro demo bot only — customer plan caps are unchanged. */
export const DEMO_DAILY_CAP = 300;
export function dailyCap(site: Site): number {
  if (site.site_key === DEMO_SITE_KEY) return DEMO_DAILY_CAP;
  return Math.max(25, Math.ceil(messageLimit(site) / 10));
}
function dailyMemoryHit(site: Site, now: Date): { ok: boolean; used: number; cap: number } {
  const day = now.toISOString().slice(0, 10);
  const key = `${site.id}:${day}`;
  if (dailyCounts.size > 5000) for (const k of dailyCounts.keys()) if (!k.endsWith(day)) dailyCounts.delete(k);
  const used = dailyCounts.get(key) ?? 0;
  const cap = dailyCap(site);
  if (used >= cap) return { ok: false, used, cap };
  dailyCounts.set(key, used + 1);
  return { ok: true, used: used + 1, cap };
}
/** Sync memory check (tests / fallback). Prefer dailyCapCheckAsync in request handlers. */
export function dailyCapCheck(site: Site, now = new Date()): { ok: boolean; used: number; cap: number } {
  return dailyMemoryHit(site, now);
}
export async function dailyCapCheckAsync(site: Site, now = new Date()): Promise<{ ok: boolean; used: number; cap: number }> {
  if (process.env.NODE_ENV === "test" && process.env.RATE_LIMIT_DB !== "1") return dailyMemoryHit(site, now);
  const cap = dailyCap(site);
  const day = now.toISOString().slice(0, 10);
  try {
    const { data, error } = await getDb().rpc("ghostchat_daily_hit", { p_site: site.id, p_day: day });
    if (error) return dailyMemoryHit(site, now);
    const used = Number(data ?? 0);
    if (used > cap) return { ok: false, used, cap };
    return { ok: true, used, cap };
  } catch {
    return dailyMemoryHit(site, now);
  }
}

export const DEFAULT_AI_DISCLOSURE = "This chat uses AI.";

/** Custom widget disclosure line. Free plans always show at least the default. */
export function effectiveDisclosure(site: Pick<Site, "plan" | "ai_disclosure">): string {
  const raw = String(site.ai_disclosure ?? DEFAULT_AI_DISCLOSURE).replace(/\s+/g, " ").trim().slice(0, 120);
  if (raw) return raw;
  const limits = PLAN_LIMITS[site.plan as Plan] ?? PLAN_LIMITS.free;
  if (limits.brandingRequired) return DEFAULT_AI_DISCLOSURE;
  return "";
}

export function sanitizeDisclosure(value: string, plan: Plan): string {
  return effectiveDisclosure({ plan, ai_disclosure: String(value ?? "") });
}
