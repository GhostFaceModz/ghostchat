/** Auto re-crawl: daily or weekly per site. In-process scheduler plus a secret-protected cron endpoint. */
import crypto from "node:crypto";
import { getDb } from "./supabase.js";
import { crawlSite, type CrawlScope } from "./crawl.js";
import { indexPages } from "./indexer.js";
import { faqCandidatesFromPages, saveFaqDrafts } from "./faqDrafts.js";
import type { Site } from "../types.js";

export const SCHEDULES = ["off", "daily", "weekly"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export function isDue(site: Pick<Site, "recrawl_schedule" | "last_crawled_at" | "crawl_status" | "updated_at">, now = Date.now()): boolean {
  const s = site.recrawl_schedule;
  if (s !== "daily" && s !== "weekly") return false;
  // A crawl stuck "crawling" for over an hour is treated as finished (e.g. the server restarted mid-crawl).
  if (site.crawl_status === "crawling" && site.updated_at && now - new Date(site.updated_at).getTime() < 3_600_000) return false;
  if (!site.last_crawled_at) return true;
  const age = now - new Date(site.last_crawled_at).getTime();
  return age >= (s === "daily" ? 23 * 3_600_000 : 6.9 * 86_400_000);
}

export function cronSecretOk(given: string | undefined, secret = process.env.CRON_SECRET || ""): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(crypto.createHash("sha256").update(given).digest("hex"));
  const b = Buffer.from(crypto.createHash("sha256").update(secret).digest("hex"));
  return crypto.timingSafeEqual(a, b);
}

export async function recrawlSite(site: Site) {
  const db = getDb();
  await db.from("ghostchat_sites").update({ crawl_status: "crawling", crawl_error: null, updated_at: new Date().toISOString() }).eq("id", site.id);
  try {
    const scope = (site.crawl_scope as CrawlScope | undefined) || undefined;
    const result = await crawlSite(site.url, site.plan, scope);
    if (!result.pages.length) throw new Error("No usable text was found on the site.");
    const summary = await indexPages(site, result.pages, { sourceType: "crawl", removeMissing: true, scope });
    await saveFaqDrafts(site.id, faqCandidatesFromPages(result.pages)).catch((err) => console.error("faq drafts:", (err as Error).message));
    await db.from("ghostchat_sites").update({ crawl_status: "ready", crawl_error: null, last_crawled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", site.id);
    return { siteId: site.id, ok: true, ...summary };
  } catch (err) {
    await db.from("ghostchat_sites").update({ crawl_status: "error", crawl_error: `Auto re-crawl: ${(err as Error).message}`, last_crawled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", site.id);
    return { siteId: site.id, ok: false, error: (err as Error).message };
  }
}

let running = false;
export function recrawlRunning(): boolean { return running; }

/** Re-crawl every due site, one at a time, within a time budget. Safe to call often (it locks). */
export async function runDueRecrawls(opts: { maxSites?: number; budgetMs?: number } = {}) {
  if (running) return { skipped: "already running", results: [] as unknown[] };
  running = true;
  const started = Date.now();
  const results: unknown[] = [];
  try {
    const { data, error } = await getDb().from("ghostchat_sites").select("*").in("recrawl_schedule", ["daily", "weekly"]).limit(500);
    if (error) throw error;
    const due = ((data ?? []) as Site[]).filter((s) => isDue(s)).sort((a, b) => String(a.last_crawled_at || "").localeCompare(String(b.last_crawled_at || "")));
    for (const site of due.slice(0, opts.maxSites ?? 5)) {
      if (Date.now() - started > (opts.budgetMs ?? 10 * 60_000)) break;
      results.push(await recrawlSite(site));
    }
    return { due: due.length, results };
  } finally {
    running = false;
  }
}

/** Hourly in-process check (the keep-warm ping keeps the free instance awake). RECRAWL_SCHEDULER=off disables it. */
export function startRecrawlScheduler(): void {
  if (String(process.env.RECRAWL_SCHEDULER || "").toLowerCase() === "off" || process.env.NODE_ENV === "test") return;
  const tick = () => runDueRecrawls().then((r) => { if ((r as { results: unknown[] }).results.length) console.log("auto re-crawl:", JSON.stringify(r)); }).catch((e) => console.error("auto re-crawl failed:", (e as Error).message));
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 60 * 60_000).unref();
}
