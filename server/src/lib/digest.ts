import { config, PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "./supabase.js";
import { canUseDigest } from "./team.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { computeAnalytics, type LogRow } from "./analytics.js";

export type DigestPayload = {
  week: string;
  rangeLabel: string;
  sites: Array<{ id: string; name: string; messages: number; unanswered: number }>;
  messages: number;
  usage: { used: number; limit: number; credits: number; plan: Plan };
  unanswered: Array<{ question: string; site: string }>;
  leads: number;
  csat: { count: number; average: number | null };
};

/** UTC ISO week key, e.g. 2026-W47. */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weekRange(now = new Date()): { since: Date; until: Date } {
  const until = new Date(now);
  const since = new Date(now.getTime() - 7 * 86400000);
  return { since, until };
}

export function renderDigestText(ownerName: string | null, p: DigestPayload): { subject: string; text: string; html: string } {
  const hi = ownerName ? `Hi ${ownerName},` : "Hi,";
  const csat = p.csat.count ? `${p.csat.average}/5 from ${p.csat.count} rating${p.csat.count === 1 ? "" : "s"}` : "No ratings yet";
  const usage = `${p.usage.used.toLocaleString("en-GB")} / ${p.usage.limit.toLocaleString("en-GB")} credits used this period` + (p.usage.credits ? ` · ${p.usage.credits.toLocaleString("en-GB")} top-up credits left` : "");
  const gaps = p.unanswered.length
    ? p.unanswered.slice(0, 8).map((q, i) => `${i + 1}. ${q.question}${q.site ? ` (${q.site})` : ""}`).join("\n")
    : "No unanswered questions this week. Nice.";
  const subject = `GhostChat weekly: ${p.messages} messages, ${p.leads} lead${p.leads === 1 ? "" : "s"}`;
  const text = `${hi}\n\nHere's your GhostChat week (${p.rangeLabel}).\n\n${p.messages} messages across ${p.sites.length} site${p.sites.length === 1 ? "" : "s"}\n${p.leads} new lead${p.leads === 1 ? "" : "s"}\nCSAT: ${csat}\nUsage: ${usage}\n\nQuestions the bot wasn't sure about:\n${gaps}\n\nOpen the dashboard to teach answers or invite a teammate:\n${config.publicUrl}/dashboard\n\nYou're getting this because weekly digest email is on in My account.`;
  const gapHtml = p.unanswered.length
    ? `<ol>${p.unanswered.slice(0, 8).map((q) => `<li>${escapeHtml(q.question)}${q.site ? ` <span style="color:#888">(${escapeHtml(q.site)})</span>` : ""}</li>`).join("")}</ol>`
    : "<p>No unanswered questions this week. Nice.</p>";
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111"><p>${escapeHtml(hi)}</p><p>Here's your GhostChat week (${escapeHtml(p.rangeLabel)}).</p><ul><li><b>${p.messages}</b> messages across ${p.sites.length} site${p.sites.length === 1 ? "" : "s"}</li><li><b>${p.leads}</b> new lead${p.leads === 1 ? "" : "s"}</li><li>CSAT: ${escapeHtml(csat)}</li><li>Usage: ${escapeHtml(usage)}</li></ul><h3>Unanswered questions</h3>${gapHtml}<p><a href="${config.publicUrl}/dashboard">Open the dashboard</a> to teach answers or invite a teammate.</p><p style="color:#888;font-size:12px">You're getting this because weekly digest email is on in My account.</p></div>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function buildDigest(ownerId: string, now = new Date()): Promise<DigestPayload> {
  const { since, until } = weekRange(now);
  const week = isoWeekKey(now);
  const rangeLabel = `${since.toISOString().slice(0, 10)} – ${until.toISOString().slice(0, 10)}`;
  const db = getDb();
  const { data: sites } = await db.from("ghostchat_sites").select("id, name, messages_this_period, plan, owner_id").eq("owner_id", ownerId);
  const list = sites || [];
  const sinceIso = since.toISOString();
  const unanswered: DigestPayload["unanswered"] = [];
  const siteRows: DigestPayload["sites"] = [];
  let messages = 0;
  let leads = 0;
  const csatAll: number[] = [];
  for (const site of list) {
    const [{ data: logs }, { count: leadCount }, { data: csat }] = await Promise.all([
      db.from("ghostchat_logs").select("id, session_id, role, message, was_unsure, feedback, page_url, created_at, lang")
        .eq("site_id", site.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(2000),
      db.from("ghostchat_leads").select("id", { count: "exact", head: true }).eq("site_id", site.id).gte("created_at", sinceIso),
      db.from("ghostchat_csat").select("rating").eq("site_id", site.id).gte("created_at", sinceIso).limit(1000),
    ]);
    const a = computeAnalytics({
      logs: (logs ?? []) as LogRow[],
      leads: leadCount ?? 0,
      csat: (csat ?? []).map((c: { rating: number }) => c.rating),
      days: 7,
      now,
    });
    const gap = a.lowConfidence.filter((x) => x.reason === "unsure");
    messages += a.totals.messages;
    leads += leadCount ?? 0;
    csatAll.push(...(csat ?? []).map((c: { rating: number }) => c.rating));
    siteRows.push({ id: site.id, name: site.name || "Untitled site", messages: a.totals.messages, unanswered: gap.length });
    for (const g of gap.slice(0, 5)) {
      if (g.question) unanswered.push({ question: g.question.slice(0, 240), site: site.name || "Site" });
    }
  }
  const { data: owner } = await db.from("ghostchat_owners").select("plan, message_credits").eq("id", ownerId).maybeSingle();
  const plan = ((owner?.plan as Plan) || "free");
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).monthlyMessages;
  const used = list.reduce((n, s) => n + (s.messages_this_period || 0), 0);
  return {
    week,
    rangeLabel,
    sites: siteRows,
    messages,
    usage: { used, limit, credits: owner?.message_credits || 0, plan },
    unanswered: unanswered.slice(0, 10),
    leads,
    csat: { count: csatAll.length, average: csatAll.length ? Math.round((csatAll.reduce((a, b) => a + b, 0) / csatAll.length) * 10) / 10 : null },
  };
}

export async function saveDigest(ownerId: string, payload: DigestPayload, emailed: boolean): Promise<void> {
  await getDb().from("ghostchat_digests").upsert({
    owner_id: ownerId,
    week: payload.week,
    payload,
    emailed,
    created_at: new Date().toISOString(),
  }, { onConflict: "owner_id,week" });
}

export async function latestDigest(ownerId: string): Promise<{ week: string; payload: DigestPayload; emailed: boolean; created_at: string } | null> {
  const { data } = await getDb()
    .from("ghostchat_digests")
    .select("week, payload, emailed, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { week: string; payload: DigestPayload; emailed: boolean; created_at: string } | null) ?? null;
}

export async function sendWeeklyDigests(now = new Date()): Promise<{ scanned: number; sent: number; stored: number; skipped: number }> {
  const week = isoWeekKey(now);
  const db = getDb();
  const { data: owners, error } = await db
    .from("ghostchat_owners")
    .select("id, email, name, plan, digest_opt_in, digest_last_week")
    .eq("digest_opt_in", true);
  if (error) throw error;
  let sent = 0, stored = 0, skipped = 0;
  const rows = owners || [];
  for (const owner of rows) {
    const plan = (owner.plan as Plan) || "free";
    if (!canUseDigest(plan)) { skipped++; continue; }
    if (owner.digest_last_week === week) { skipped++; continue; }
    const payload = await buildDigest(owner.id, now);
    let emailed = false;
    if (mailerConfigured() && owner.email) {
      const letter = renderDigestText(owner.name, payload);
      const result = await sendMail({ to: owner.email, subject: letter.subject, text: letter.text, html: letter.html });
      emailed = result.ok;
      if (result.ok) sent++;
    }
    await saveDigest(owner.id, payload, emailed);
    await db.from("ghostchat_owners").update({ digest_last_week: week, updated_at: new Date().toISOString() }).eq("id", owner.id);
    stored++;
  }
  return { scanned: rows.length, sent, stored, skipped };
}
