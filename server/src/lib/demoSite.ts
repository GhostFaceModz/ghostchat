/** Official GhostChat demo / dogfood site, trained on ghostchat.pro pages and the setup guide. */
import { getDb } from "./supabase.js";
import { crawlSite } from "./crawl.js";
import { indexPages } from "./indexer.js";
import type { Site } from "../types.js";
import { ensureGhostChatKnowledgePack } from "./ghostchatKnowledgePack.js";
import { ensureGhostChatEvalQuestions } from "./ghostchatEvalSet.js";

export const DEMO_SITE_KEY = "gc_demo_ghostchat_pro";
export const DEMO_SITE_URL = "https://ghostchat.pro";

const STARTER = [
  "What does the Pro plan include?",
  "How do I add the widget to my site?",
  "What's the difference between Helpful and Strict answers?",
];

const SCOPE = {
  include: ["/", "/guide", "/privacy", "/terms"],
  exclude: ["/dashboard", "/login", "/signup", "/api", "/c/", "/og/", "/account"],
};

async function ownerId(): Promise<string | null> {
  const db = getDb();
  const admin = await db.from("ghostchat_owners").select("id").eq("is_admin", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (admin.data?.id) return admin.data.id as string;
  const any = await db.from("ghostchat_owners").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  return (any.data?.id as string) || null;
}

export async function ensureDemoSite(): Promise<{ site?: Site; crawled?: boolean; skipped?: string }> {
  if (process.env.NODE_ENV === "test") return { skipped: "test" };
  const db = getDb();
  const existing = await db.from("ghostchat_sites").select("*").eq("site_key", DEMO_SITE_KEY).maybeSingle();
  let site = existing.data as Site | null;
  if (!site) {
    const owner = await ownerId();
    if (!owner) return { skipped: "no owner to attach the demo site to" };
    const { data, error } = await db.from("ghostchat_sites").insert({
      owner_id: owner,
      name: "GhostChat",
      url: DEMO_SITE_URL,
      site_key: DEMO_SITE_KEY,
      greeting: "Hi — I'm GhostChat's own assistant. Ask me about plans, the setup guide, or how the widget works.",
      persona: "You are GhostChat's official assistant. Answer from the ghostchat.pro pages and setup guide. Be clear and concise.",
      tone: "friendly",
      starter_questions: STARTER,
      recrawl_schedule: "weekly",
      crawl_scope: SCOPE,
      live_lookup: true,
      plan: "free",
    }).select("*").single();
    if (error) throw error;
    site = data as Site;
  }
  const pages = Number(site.page_count || 0);
  const stale = !site.last_crawled_at || (Date.now() - Date.parse(String(site.last_crawled_at))) > 6 * 24 * 3600 * 1000;
  const missingYearly = await demoIndexMissingYearlyPrices(site.id);
  if (pages === 0 || stale || missingYearly) {
    const result = await crawlSite(site.url || DEMO_SITE_URL, site.plan || "free", (site.crawl_scope as typeof SCOPE) || SCOPE);
    await indexPages(site, result.pages, { sourceType: "crawl", removeMissing: true, scope: (site.crawl_scope as typeof SCOPE) || SCOPE });
    await db.from("ghostchat_sites").update({
      crawl_status: result.pages.length ? "ready" : "error",
      crawl_error: result.pages.length ? null : "No usable text was found on the site.",
      last_crawled_at: new Date().toISOString(),
      recrawl_schedule: site.recrawl_schedule || "weekly",
      crawl_scope: site.crawl_scope || SCOPE,
      updated_at: new Date().toISOString(),
    }).eq("id", site.id);
    site = { ...site, last_crawled_at: new Date().toISOString(), page_count: result.pages.length } as Site;
    await seedOfficialKnowledge(site).catch((err) => console.error("demo knowledge seed:", (err as Error).message));
    return { site, crawled: true };
  }
  await seedOfficialKnowledge(site).catch((err) => console.error("demo knowledge seed:", (err as Error).message));
  return { site, crawled: false };
}

async function demoIndexMissingYearlyPrices(siteId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("ghostchat_chunks")
    .select("id")
    .eq("site_id", siteId)
    .ilike("content", "%two months free%")
    .limit(1);
  if (error) return true;
  return !data?.length;
}

async function seedOfficialKnowledge(site: Site): Promise<void> {
  const pack = await ensureGhostChatKnowledgePack(site);
  const ev = await ensureGhostChatEvalQuestions(site.id);
  console.log(`demo knowledge: pack ${pack.reason} (${pack.chunks} chunks); eval +${ev.added} (total ${ev.total})`);
}
