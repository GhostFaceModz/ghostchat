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

export async function assertCanSend(site: Site): Promise<Site> {
  const fresh = await refreshPeriod(site);
  if (fresh.messages_this_period >= messageLimit(fresh)) {
    const err = new Error("This site has reached its monthly message limit. Upgrade the plan to keep chatting.");
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  return fresh;
}

export async function incrementMessages(siteId: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from("ghostchat_sites")
    .select("messages_this_period")
    .eq("id", siteId)
    .single();
  if (error) throw error;
  await db
    .from("ghostchat_sites")
    .update({
      messages_this_period: (data?.messages_this_period ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
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
