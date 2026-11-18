/**
 * Live site lookup: when the index can't answer confidently, search the owner's own site in real time
 * (its search page, sitemap or likely links), read the best pages, answer from them, and index them for next time.
 * Same-domain only, respects the crawl scope and robots.txt, strict total time budget and rate limits.
 */
import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "./ssrf.js";
import { extractText, inScope, type CrawledPage, type CrawlScope } from "./crawl.js";
import { chunkText } from "./chunk.js";
import { embedTexts } from "./ai.js";
import { rateLimitAsync } from "./rateLimit.js";
import { similarityThreshold } from "./chat.js";
import type { RetrievedChunk, Site } from "../types.js";

export const LOOKUP_BUDGET_MS = Number(process.env.LOOKUP_BUDGET_MS) || 7000;
const UA = "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)";
const SKIP_EXT = /\.(pdf|zip|gz|png|jpe?g|gif|webp|svg|ico|mp[34]|wav|mov|css|js|json|xml|txt)$/i;
const STOP = new Set("the a an and or but if then of to in on at for from by with about as is are was were be been do does did can could would should will shall may might must have has had you your yours i me my we our us they them their it its this that these those what which who whom whose when where why how there here any some all not no yes please tell know find show give get want need like just more most much many also into over than very really".split(" "));

export function keywords(question: string, max = 8): string[] {
  const out: string[] = [];
  for (const w of question.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) || []) {
    if (STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Score a link by how many question keywords appear in its path and anchor text (stems: first 5 letters). */
export function scoreLink(url: string, text: string, kws: string[]): number {
  let path = "";
  try { path = decodeURIComponent(new URL(url).pathname).toLowerCase(); } catch { return 0; }
  const hay = `${path.replace(/[-_/.]+/g, " ")} ${text.toLowerCase()}`;
  let score = 0;
  for (const k of kws) {
    const stem = k.length > 5 ? k.slice(0, 5) : k;
    if (hay.includes(k)) score += 2; else if (hay.includes(stem)) score += 1;
  }
  return score;
}

/** Minimal robots.txt: Disallow/Allow rules for "*" or GhostChatBot. Longest match wins. */
export function parseRobots(txt: string, ua = "ghostchatbot"): (path: string) => boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === "allow", path: val });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  return (path: string) => {
    let best: { allow: boolean; len: number } | null = null;
    for (const r of rules) {
      const pat = r.path.replace(/\$$/, "");
      const re = new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (r.path.endsWith("$") ? "$" : ""));
      if (re.test(path) && (!best || pat.length > best.len || (pat.length === best.len && r.allow))) best = { allow: r.allow, len: pat.length };
    }
    return best ? best.allow : true;
  };
}

/** Find a GET search form on the page and turn it into a URL template with {query}. */
export function detectSearchUrl(html: string, base: string): string | null {
  const $ = cheerio.load(html);
  const forms = $("form").toArray();
  for (const f of forms) {
    const form = $(f);
    const method = (form.attr("method") || "get").toLowerCase();
    if (method !== "get") continue;
    const input = form.find("input[type=search], input[name=q], input[name=s], input[name=query], input[name=search], input[name=keyword], input[name=term]").first();
    const name = input.attr("name");
    if (!name) continue;
    try {
      const action = new URL(form.attr("action") || "", base);
      if (action.host !== new URL(base).host) continue;
      action.search = "";
      return `${action.href}?${encodeURIComponent(name)}={query}`;
    } catch { /* skip */ }
  }
  return null;
}

export function fillSearch(template: string, query: string): string {
  return template.replace(/\{query\}/g, encodeURIComponent(query));
}

function linksWithText(html: string, base: string): Array<{ href: string; text: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try { out.push({ href: new URL(href, base).href, text: ($(el).text() || $(el).attr("title") || $(el).find("img").attr("alt") || "").replace(/\s+/g, " ").trim().slice(0, 200) }); } catch { /* bad href */ }
  });
  return out;
}

// ---- small caches (per process) ----
type Cached<T> = { at: number; value: T };
const robotsCache = new Map<string, Cached<(p: string) => boolean>>();
const sitemapCache = new Map<string, Cached<string[]>>();
const searchCache = new Map<string, Cached<string | null>>();
const missCache = new Map<string, number>();
const HOUR = 3_600_000;
const fresh = <T>(c: Cached<T> | undefined, ttl: number) => (c && Date.now() - c.at < ttl ? c : null);

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** GET a same-host URL. Redirects are followed by hand and only while they stay on the same host (no off-domain fetches). */
export async function getSameHost(url: string, host: string, ms: number, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ text: string; finalUrl: URL; type: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort);
  try {
    let current = new URL(url);
    for (let hop = 0; hop < 4; hop++) {
      if (current.host !== host || !/^https?:$/.test(current.protocol)) return null;
      const res = await fetchImpl(current.href, { signal: ctrl.signal, redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.5" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, current);
        continue;
      }
      if (!res.ok) return null;
      const text = await res.text();
      return { text: text.length > 1_000_000 ? text.slice(0, 1_000_000) : text, finalUrl: current, type: res.headers.get("content-type") || "" };
    }
    return null;
  } catch { return null; } finally { clearTimeout(t); signal.removeEventListener("abort", onAbort); }
}

/** Sitemap URLs (same host only, follows one level of sitemap index, up to 3 child sitemaps). */
async function sitemapUrls(origin: URL, host: string, custom: string | undefined, signal: AbortSignal, ms: () => number): Promise<string[]> {
  const first = custom ? new URL(custom, origin).href : new URL("/sitemap.xml", origin).href;
  const got = await getSameHost(first, host, ms(), signal);
  if (!got) return [];
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  if (!/<sitemapindex/i.test(got.text)) return locs(got.text).slice(0, 2000);
  const kids = locs(got.text).slice(0, 3);
  const all = await Promise.all(kids.map((k) => getSameHost(k, host, ms(), signal)));
  return all.flatMap((g) => (g ? locs(g.text) : [])).slice(0, 2000);
}

/** Per-site and per-visitor limits so lookups can't be abused to hammer a site. */
export async function lookupAllowed(siteId: string, sessionId: string): Promise<boolean> {
  if (!(await rateLimitAsync(`lookup:sid:${siteId}:${sessionId}`, 4, 10 * 60_000)).ok) return false;
  return (await rateLimitAsync(`lookup:site:${siteId}`, 20, 60_000)).ok && (await rateLimitAsync(`lookup:site:h:${siteId}`, 200, HOUR)).ok;
}

/** Should we look the question up live? Only when the index has nothing confident. */
export function needsLookup(site: Pick<Site, "live_lookup">, chunks: RetrievedChunk[]): boolean {
  if (site.live_lookup === false) return false;
  if (chunks.some((c) => String(c.id).startsWith("correction:"))) return false;
  const top = Math.max(0, ...chunks.map((c) => c.similarity || 0));
  return top < similarityThreshold() + 0.1;
}

export type LookupResult = { chunks: RetrievedChunk[]; pages: CrawledPage[]; tried: string[]; via: string[] };

export async function liveLookup(site: Pick<Site, "id" | "url" | "crawl_scope" | "lookup_search_url">, question: string, opts: { budgetMs?: number } = {}): Promise<LookupResult | null> {
  const started = Date.now();
  const budget = opts.budgetMs ?? LOOKUP_BUDGET_MS;
  const left = () => budget - (Date.now() - started);
  const kws = keywords(question);
  if (!kws.length) return null;
  const missKey = `${site.id}:${kws.join(" ")}`;
  if ((missCache.get(missKey) || 0) > Date.now()) return null;
  const abort = new AbortController();
  const killer = setTimeout(() => abort.abort(), budget);
  try {
    const origin = await assertPublicHttpUrl(site.url);
    const host = origin.host;
    const scope = (site.crawl_scope as CrawlScope | undefined) || undefined;
    const via: string[] = [];

    // robots.txt (cached 6h)
    let allowed = fresh(robotsCache.get(host), 6 * HOUR)?.value;
    if (!allowed) {
      const got = await withDeadline(getSameHost(new URL("/robots.txt", origin).href, host, Math.min(1500, left()), abort.signal), Math.min(1500, left()), null);
      allowed = parseRobots(got && !/html/i.test(got.type) ? got.text : "");
      robotsCache.set(host, { at: Date.now(), value: allowed });
    }

    const candidates = new Map<string, number>();
    const consider = (href: string, text: string, bonus = 0) => {
      let u: URL;
      try { u = new URL(href); } catch { return; }
      if (u.host !== host || !/^https?:$/.test(u.protocol) || SKIP_EXT.test(u.pathname)) return;
      u.hash = "";
      if (!inScope(u, scope) || !allowed!(u.pathname)) return;
      if (u.pathname === origin.pathname && !u.search) return; // the home page itself is rarely the answer
      const s = scoreLink(u.href, text, kws);
      if (s <= 0) return;
      candidates.set(u.href, Math.max(candidates.get(u.href) || 0, s + bonus));
    };

    // 1) the site's own search (configured, or detected on the home page and cached)
    let homeHtml: string | null = null;
    let searchTpl = site.lookup_search_url || fresh(searchCache.get(host), 6 * HOUR)?.value || null;
    if (!site.lookup_search_url && !searchCache.has(host)) {
      homeHtml = (await withDeadline(getSameHost(origin.href, host, Math.min(2000, left()), abort.signal), Math.min(2000, left()), null))?.text ?? null;
      searchTpl = homeHtml ? detectSearchUrl(homeHtml, origin.href) : null;
      searchCache.set(host, { at: Date.now(), value: searchTpl });
    }
    const sitemapP = (async () => {
      const c = fresh(sitemapCache.get(host), 6 * HOUR);
      if (c) return c.value;
      const scopeSm = scope?.sitemap_url;
      const urls = await withDeadline(sitemapUrls(origin, host, scopeSm, abort.signal, () => Math.min(2500, left())), Math.min(2500, left()), [] as string[]);
      if (urls.length) sitemapCache.set(host, { at: Date.now(), value: urls });
      return urls;
    })();
    const searchP = (async () => {
      if (!searchTpl) return;
      const url = fillSearch(searchTpl, kws.slice(0, 5).join(" "));
      try { if (new URL(url).host !== host) return; } catch { return; }
      const html = (await withDeadline(getSameHost(url, host, Math.min(2500, left()), abort.signal), Math.min(2500, left()), null))?.text;
      if (!html) return;
      via.push("search");
      for (const l of linksWithText(html, url)) consider(l.href, l.text, 1);
    })();
    const [sitemap] = await Promise.all([sitemapP, searchP]);
    if (sitemap.length) { via.push("sitemap"); for (const u of sitemap) consider(u, ""); }
    if (candidates.size < 2) {
      homeHtml = homeHtml ?? ((await withDeadline(getSameHost(origin.href, host, Math.min(2000, left()), abort.signal), Math.min(2000, left()), null))?.text ?? null);
      if (homeHtml) { via.push("links"); for (const l of linksWithText(homeHtml, origin.href)) consider(l.href, l.text); }
    }
    const picks = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u]) => u);
    if (!picks.length || left() < 800) { missCache.set(missKey, Date.now() + 10 * 60_000); return null; }

    // 2) read the best pages in parallel
    const per = Math.max(800, Math.min(3500, left() - 400));
    const fetched = await Promise.all(picks.map((u) => getSameHost(u, host, per, abort.signal)));
    const pages: CrawledPage[] = [];
    for (const f of fetched) {
      if (!f || !/html/i.test(f.type) || f.finalUrl.host !== host || !inScope(f.finalUrl, scope) || !allowed(f.finalUrl.pathname)) continue;
      const { title, text } = extractText(f.text, f.finalUrl.href);
      if (text.length >= 80) pages.push({ url: f.finalUrl.href, title, text: text.slice(0, 60_000) });
    }
    if (!pages.length) { missCache.set(missKey, Date.now() + 10 * 60_000); return null; }

    // 3) keep only passages that actually match the question
    const pieces = pages.flatMap((p) => chunkText(p.text, { title: p.title, url: p.url }).slice(0, 25).map((c) => ({ ...c, page: p })));
    const [qv, ...vecs] = await embedTexts([question, ...pieces.map((p) => p.content)]);
    const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
    const floor = similarityThreshold();
    const scored = pieces.map((p, i) => ({ p, s: cos(qv, vecs[i]) })).filter((x) => x.s >= floor).sort((a, b) => b.s - a.s).slice(0, 4);
    if (!scored.length) { missCache.set(missKey, Date.now() + 10 * 60_000); return null; }
    const chunks: RetrievedChunk[] = scored.map(({ p, s }, i) => ({ id: `lookup:${i}`, site_id: site.id, url: p.page.url, title: p.page.title, content: p.content, similarity: s }));
    const used = new Set(scored.map((x) => x.p.page.url));
    return { chunks, pages: pages.filter((p) => used.has(p.url)), tried: picks, via };
  } catch {
    return null;
  } finally {
    clearTimeout(killer);
  }
}

export const _test = { robotsCache, sitemapCache, searchCache, missCache };
