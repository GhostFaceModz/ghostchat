/** Optional auto-recharge of existing £5 / £15 Whop top-up packs, with a monthly cap. */
import { getDb } from "./supabase.js";
import { ownerCredits } from "./usage.js";
import { config, PLAN_LIMITS, type Plan } from "../config.js";

export type AutoRechargeSettings = {
  enabled: boolean;
  pack: 1000 | 5000;
  capGbp: number;
  spentGbp: number;
  month: string | null;
};

export function utcMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function normalizeSettings(raw: Partial<AutoRechargeSettings> | Record<string, unknown> | null | undefined): AutoRechargeSettings {
  const pack = Number((raw as AutoRechargeSettings | undefined)?.pack) === 5000 ? 5000 : 1000;
  const cap = Math.max(5, Math.min(150, Number((raw as AutoRechargeSettings | undefined)?.capGbp) || 15));
  return {
    enabled: Boolean((raw as AutoRechargeSettings | undefined)?.enabled),
    pack,
    capGbp: cap,
    spentGbp: Math.max(0, Number((raw as AutoRechargeSettings | undefined)?.spentGbp) || 0),
    month: typeof (raw as AutoRechargeSettings | undefined)?.month === "string" ? (raw as AutoRechargeSettings).month : null,
  };
}

export function packPrice(pack: 1000 | 5000): number {
  return pack === 5000 ? 15 : 5;
}

export function packCheckoutUrl(pack: 1000 | 5000): string | null {
  const id = pack === 5000 ? config.whopTopup5000Id : config.whopTopup1000Id;
  return id ? `https://whop.com/checkout/${id}` : null;
}

export function canRecharge(s: AutoRechargeSettings, now = new Date()): { ok: boolean; reason?: string; price: number } {
  const price = packPrice(s.pack);
  if (!s.enabled) return { ok: false, reason: "off", price };
  const month = utcMonth(now);
  const spent = s.month === month ? s.spentGbp : 0;
  if (spent + price > s.capGbp) return { ok: false, reason: "cap", price };
  return { ok: true, price };
}

type OwnerRow = {
  id: string;
  plan: Plan;
  message_credits: number;
  auto_recharge: boolean;
  auto_recharge_pack: number;
  auto_recharge_cap_gbp: number;
  auto_recharge_month: string | null;
  auto_recharge_spent_gbp: number;
};

function settingsFromOwner(o: OwnerRow): AutoRechargeSettings {
  return normalizeSettings({
    enabled: o.auto_recharge,
    pack: o.auto_recharge_pack as 1000 | 5000,
    capGbp: o.auto_recharge_cap_gbp,
    spentGbp: o.auto_recharge_spent_gbp,
    month: o.auto_recharge_month,
  });
}

/** Low when remaining allowance + credits would cover fewer than ~200 one-credit replies, or credits are under one pack's worth while the allowance is already used. */
export function creditsLookLow(used: number, limit: number, credits: number): boolean {
  const remainingAllowance = Math.max(0, limit - used);
  return remainingAllowance + credits <= 200;
}

export async function saveAutoRecharge(ownerId: string, patch: { enabled?: boolean; pack?: 1000 | 5000; capGbp?: number }): Promise<AutoRechargeSettings> {
  const current = await loadAutoRecharge(ownerId);
  const next = normalizeSettings({
    ...current,
    enabled: patch.enabled ?? current.enabled,
    pack: patch.pack ?? current.pack,
    capGbp: patch.capGbp ?? current.capGbp,
  });
  const { error } = await getDb().from("ghostchat_owners").update({
    auto_recharge: next.enabled,
    auto_recharge_pack: next.pack,
    auto_recharge_cap_gbp: next.capGbp,
    updated_at: new Date().toISOString(),
  }).eq("id", ownerId);
  if (error) throw error;
  return { ...current, ...next };
}

export async function loadAutoRecharge(ownerId: string): Promise<AutoRechargeSettings> {
  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("auto_recharge, auto_recharge_pack, auto_recharge_cap_gbp, auto_recharge_month, auto_recharge_spent_gbp")
    .eq("id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return normalizeSettings({
    enabled: data?.auto_recharge,
    pack: data?.auto_recharge_pack,
    capGbp: data?.auto_recharge_cap_gbp,
    spentGbp: data?.auto_recharge_spent_gbp,
    month: data?.auto_recharge_month,
  });
}

export async function recordAutoRechargeSpend(ownerId: string, priceGbp: number, now = new Date()): Promise<void> {
  const month = utcMonth(now);
  const current = await loadAutoRecharge(ownerId);
  const spent = current.month === month ? current.spentGbp : 0;
  await getDb().from("ghostchat_owners").update({
    auto_recharge_month: month,
    auto_recharge_spent_gbp: spent + priceGbp,
    updated_at: now.toISOString(),
  }).eq("id", ownerId);
}

export type RechargePrompt = {
  ownerId: string;
  pack: 1000 | 5000;
  priceGbp: number;
  checkoutUrl: string | null;
  reason: string;
};

/** Find paid owners who opted in, are low on credits, and still have cap room. Does not charge a card. */
export async function findRechargePrompts(opts: { maxOwners?: number } = {}): Promise<RechargePrompt[]> {
  const db = getDb();
  const { data, error } = await db
    .from("ghostchat_owners")
    .select("id, plan, message_credits, auto_recharge, auto_recharge_pack, auto_recharge_cap_gbp, auto_recharge_month, auto_recharge_spent_gbp")
    .eq("auto_recharge", true)
    .in("plan", ["pro", "business"])
    .limit(opts.maxOwners || 100);
  if (error || !data) return [];
  const out: RechargePrompt[] = [];
  for (const row of data as OwnerRow[]) {
    const settings = settingsFromOwner(row);
    const gate = canRecharge(settings);
    if (!gate.ok) continue;
    const { data: sites } = await db.from("ghostchat_sites").select("messages_this_period, plan").eq("owner_id", row.id).limit(20);
    const used = Math.max(0, ...((sites || []) as Array<{ messages_this_period: number }>).map((s) => Number(s.messages_this_period) || 0));
    const limit = (PLAN_LIMITS[row.plan] || PLAN_LIMITS.free).monthlyMessages;
    const credits = Number(row.message_credits) || (await ownerCredits(row.id).catch(() => 0));
    if (!creditsLookLow(used, limit, credits)) continue;
    const url = packCheckoutUrl(settings.pack);
    out.push({ ownerId: row.id, pack: settings.pack, priceGbp: gate.price, checkoutUrl: url, reason: "low_credits" });
  }
  return out;
}

export async function promptDueRecharges(): Promise<{ prompted: number; skipped: number }> {
  const due = await findRechargePrompts();
  let prompted = 0;
  let skipped = 0;
  const db = getDb();
  const month = utcMonth();
  for (const item of due) {
    const { data: recent } = await db
      .from("ghostchat_auto_recharge_events")
      .select("id")
      .eq("owner_id", item.ownerId)
      .eq("month", month)
      .eq("status", "needed")
      .limit(1)
      .maybeSingle();
    if (recent) { skipped++; continue; }
    const { error } = await db.from("ghostchat_auto_recharge_events").insert({
      owner_id: item.ownerId,
      pack: item.pack,
      price_gbp: item.priceGbp,
      status: "needed",
      reason: item.reason,
      month,
    });
    if (error) skipped++;
    else prompted++;
  }
  return { prompted, skipped };
}

export async function latestRechargePrompt(ownerId: string): Promise<{ pack: number; priceGbp: number; checkoutUrl: string | null; status: string } | null> {
  const month = utcMonth();
  const { data } = await getDb()
    .from("ghostchat_auto_recharge_events")
    .select("pack, price_gbp, status")
    .eq("owner_id", ownerId)
    .eq("month", month)
    .in("status", ["needed", "prompted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const pack = Number(data.pack) === 5000 ? 5000 : 1000;
  return { pack, priceGbp: Number(data.price_gbp) || packPrice(pack), checkoutUrl: packCheckoutUrl(pack), status: data.status };
}
