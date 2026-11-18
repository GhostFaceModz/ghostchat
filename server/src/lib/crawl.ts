import * as cheerio from "cheerio";
import { config, PLAN_LIMITS, type Plan } from "../config.js";
import { chunkText, type TextChunk } from "./chunk.js";
import { assertPublicHttpUrl, sameOrigin } from "./ssrf.js";
import { extractJsonLd, discoverStructuredPages, productsToPages, JS_RENDER_SKIPPED as JS_RENDER_NOTE } from "./structuredData.js";
import { extractPdfText } from "./pdf.js";
import { extractLinkedDocument } from "./documents.js";

/** Chromium does not fit free Render RAM. See JS_RENDER_SKIPPED for the paid alternative. */
export const JS_RENDER_SKIPPED = JS_RENDER_NOTE;

const SKIP_EXT = /\.(zip|gz|tar|rar|7z|png|jpe?g|gif|webp|svg|ico|mp[34]|wav|avi|mov|wmv|mkv|css|js|mjs|map|woff2?|ttf|eot|xml|json)$/i;
const PDF_EXT = /\.pdf$/i;
const DOC_EXT = /\.(docx?|rtf|odt|txt|md)$/i;
const POLITE_MS = process.env.CRAWL_POLITE_MS != null ? Number(process.env.CRAWL_POLITE_MS) : process.env.NODE_ENV === "test" ? 0 : 150;

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
  sections?: Array<{ heading: string; text: string }>;
};

export type CrawlIssue = {
  url: string;
  status?: number | null;
  finalUrl?: string;
  reason: "http" | "type" | "too_large" | "network" | "redirect" | "redirect_offsite";
};

export type CrawlResult = {
  pages: CrawledPage[];
  chunks: Array<TextChunk & { sourceUrl: string }>;
  errors: string[];
  issues: CrawlIssue[];
};

export function urlKey(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, "");
    return `${x.host}${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

export function resolveRedirect(from: URL, location: string | null): URL | null {
  if (!location) return null;
  try {
    return new URL(location, from);
  } catch {
    return null;
  }
}

export function isTrivialRedirect(from: string, to: string): boolean {
  return urlKey(from) === urlKey(to);
}

export function extractText(html: string, pageUrl: string): { title: string; text: string; links: string[]; sections: Array<{ heading: string; text: string }>; jsonLdHtml?: string } {
  const $ = cheerio.load(html);
  const jsonLdHtml = html;
  $("script:not([type='application/ld+json']), style, noscript, nav, footer, iframe, svg, canvas, form, header").remove();
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    pageUrl;
  const sections: Array<{ heading: string; text: string }> = [];
  let currentHeading = title;
  let bucket: string[] = [];
  const flush = () => {
    const text = bucket.join("\n\n").trim();
    if (text.length >= 40) sections.push({ heading: currentHeading, text });
    bucket = [];
  };
  $("h1, h2, h3, h4, p, li, dt, dd, article, section, td, th, blockquote, pre").each((_, el) => {
    const tag = String($(el).prop("tagName") || "").toLowerCase();
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!t) return;
    if (/^h[1-4]$/.test(tag)) {
      flush();
      currentHeading = t;
      return;
    }
    if (t.length >= 20) bucket.push(t);
  });
  flush();
  const parts = sections.length ? sections.map((s) => (s.heading && s.heading !== title ? `${s.heading}\n${s.text}` : s.text)) : [];
  let text = parts.join("\n\n");
  if (text.length < 80) {
    text = $("body").text().replace(/\s+/g, " ").trim();
  }
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });
  return { title, text, links, sections, jsonLdHtml };
}

export type FetchPageOk = { ok: true; html: string; finalUrl: URL; status: number; redirectedFrom?: string };
export type FetchPageFail = {
  ok: false;
  status: number | null;
  url: string;
  finalUrl?: string;
  redirectedFrom?: string;
  reason: CrawlIssue["reason"];
};
export type FetchPageOutcome = FetchPageOk | FetchPageFail;

export async function fetchPageOutcome(url: URL, timeoutMs = 12000, signal?: AbortSignal): Promise<FetchPageOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  const headers = {
    "user-agent": "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)",
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  };
  const startHost = url.host;
  let current = url;
  let redirectedFrom: string | undefined;
  const seen = new Set<string>();
  try {
    for (let hop = 0; hop < 5; hop++) {
      const key = current.href;
      if (seen.has(key)) return { ok: false, status: null, url: url.href, finalUrl: current.href, redirectedFrom, reason: "redirect" };
      seen.add(key);
      const res = await fetch(current, { method: "GET", redirect: "manual", signal: ctrl.signal, headers });
      if (res.status >= 300 && res.status < 400) {
        const next = resolveRedirect(current, res.headers.get("location"));
        if (!next) return { ok: false, status: res.status, url: url.href, finalUrl: current.href, redirectedFrom, reason: "http" };
        if (!redirectedFrom) redirectedFrom = url.href;
        if (next.host !== startHost) {
          return { ok: false, status: res.status, url: url.href, finalUrl: next.href, redirectedFrom, reason: "redirect_offsite" };
        }
        current = next;
        continue;
      }
      const ctype = res.headers.get("content-type") || "";
      const finalUrl = new URL(res.url || current.href);
      if (!res.ok) return { ok: false, status: res.status, url: url.href, finalUrl: finalUrl.href, redirectedFrom, reason: "http" };
      if (!ctype.includes("html")) return { ok: false, status: res.status, url: url.href, finalUrl: finalUrl.href, redirectedFrom, reason: "type" };
      const html = await res.text();
      if (html.length > 2_000_000) return { ok: false, status: res.status, url: url.href, finalUrl: finalUrl.href, redirectedFrom, reason: "too_large" };
      return { ok: true, html, finalUrl, status: res.status, redirectedFrom };
    }
    return { ok: false, status: null, url: url.href, finalUrl: current.href, redirectedFrom, reason: "redirect" };
  } catch {
    return { ok: false, status: null, url: url.href, redirectedFrom, reason: "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchPage(url: URL, timeoutMs = 12000, signal?: AbortSignal): Promise<{ html: string; finalUrl: URL } | null> {
  const outcome = await fetchPageOutcome(url, timeoutMs, signal);
  return outcome.ok ? { html: outcome.html, finalUrl: outcome.finalUrl } : null;
}

export function issueFromOutcome(requested: URL, outcome: FetchPageOutcome): CrawlIssue | null {
  if (!outcome.ok) {
    return { url: requested.href, status: outcome.status, finalUrl: outcome.finalUrl, reason: outcome.reason };
  }
  if (outcome.redirectedFrom && !isTrivialRedirect(outcome.redirectedFrom, outcome.finalUrl.href)) {
    return { url: outcome.redirectedFrom, status: outcome.status, finalUrl: outcome.finalUrl.href, reason: "redirect" };
  }
  return null;
}


async function politePause(): Promise<void> {
  if (POLITE_MS > 0) await new Promise((r) => setTimeout(r, POLITE_MS));
}

async function fetchPdf(url: URL, timeoutMs = 15000): Promise<CrawledPage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)", accept: "application/pdf,application/octet-stream;q=0.8" },
    });
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !(ctype.includes("pdf") || PDF_EXT.test(url.pathname))) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return null;
    const text = await extractPdfText(buf, url.pathname.split("/").pop() || "document.pdf");
    if (text.length < 40) return null;
    return { url: res.url || url.href, title: (url.pathname.split("/").pop() || "PDF").replace(/[-_]+/g, " ").replace(/\.pdf$/i, ""), text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDocument(url: URL, timeoutMs = 15000): Promise<CrawledPage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)", accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/rtf,text/plain,text/markdown,application/octet-stream;q=0.8" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return null;
    const name = url.pathname.split("/").pop() || "document";
    const text = await extractLinkedDocument(buf, name);
    if (!text || text.length < 40) return null;
    return { url: res.url || url.href, title: name.replace(/[-_]+/g, " ").replace(/\.(docx?|rtf|odt|txt|md)$/i, ""), text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CrawlScope = { sitemap_url?: string; include?: string[]; exclude?: string[]; page_chunks?: boolean };

/** Path-prefix scope: "/title/" keeps only matching pages; exclude wins over include. */
export function inScope(u: URL, scope: CrawlScope | undefined): boolean {
  if (!scope) return true;
  const p = u.pathname;
  const match = (pre: string) => { const x = pre.trim(); if (!x) return false; if (x.endsWith("*")) return p.startsWith(x.slice(0, -1)); return p === x || p.startsWith(x.endsWith("/") ? x : `${x}/`) || p.startsWith(x); };
  if ((scope.exclude || []).some(match)) return false;
  const inc = (scope.include || []).filter((x) => x.trim());
  return !inc.length || inc.some(match);
}

/** One chunk per page (title + URL + the start of the page): best for catalogues, so each answer maps to one page link. */
export function pageChunk(page: CrawledPage): TextChunk {
  const text = page.text.replace(/\s+/g, " ").trim().slice(0, 2400);
  const content = `${page.title}\nPage: ${page.url}\n${text}`;
  return { title: page.title, url: page.url, content, tokenCount: Math.max(1, Math.ceil(content.length / 4)) };
}

export async function discoverSitemapUrls(origin: URL, maxUrls: number, custom?: string): Promise<URL[]> {
  const targets = custom ? [new URL(custom, origin)] : [new URL("/sitemap.xml", origin), new URL("/sitemap_index.xml", origin)];
  const found: URL[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    try {
      await assertPublicHttpUrl(target.href);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(target, {
        method: "GET",
        signal: ctrl.signal,
        headers: { "user-agent": "GhostChatBot/1.0", accept: "application/xml,text/xml,text/plain" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const xml = await res.text();
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
      // A sitemap index lists more sitemaps: follow up to 5 of them.
      if (/<sitemapindex/i.test(xml) && targets.length < 8) {
        for (const loc of locs.slice(0, 5)) { const n = sameOrigin(origin, loc); if (n && !targets.some((t) => t.href === n.href)) targets.push(n); }
        continue;
      }
      for (const loc of locs) {
        const next = sameOrigin(origin, loc);
        if (!next || seen.has(next.href)) continue;
        seen.add(next.href);
        found.push(next);
        if (found.length >= maxUrls) return found;
      }
    } catch {
      // sitemap is optional
    }
  }
  return found;
}

export async function crawlSite(startUrl: string, plan: Plan, scope?: CrawlScope): Promise<CrawlResult> {
  const origin = await assertPublicHttpUrl(startUrl);
  const maxPages = Math.min(config.crawlMaxPages, PLAN_LIMITS[plan].maxPages);
  const maxDepth = config.crawlMaxDepth;
  const queue: Array<{ url: URL; depth: number }> = [{ url: origin, depth: 0 }];
  const seen = new Set<string>();
  const sitemapOnly = !!scope?.sitemap_url;
  if (sitemapOnly) queue.length = 0; // precise mode: only the pages the sitemap lists (filtered by the scope)
  for (const sitemapUrl of await discoverSitemapUrls(origin, sitemapOnly ? maxPages * 3 : maxPages, scope?.sitemap_url)) {
    if (inScope(sitemapUrl, scope)) queue.push({ url: sitemapUrl, depth: sitemapOnly ? config.crawlMaxDepth : 1 });
  }
  const pages: CrawledPage[] = [];
  const errors: string[] = [];
  const issues: CrawlIssue[] = [];
  if (sitemapOnly && !queue.length) errors.push("The sitemap had no pages inside the chosen scope.");

  const normalize = (u: URL) => {
    const copy = new URL(u.href);
    copy.hash = "";
    if (copy.pathname.endsWith("/")) copy.pathname = copy.pathname.slice(0, -1) || "/";
    return copy.href;
  };

  let budget = maxPages * 3; // pages outside the scope still get visited to find links, up to a limit
  while (queue.length && pages.length < maxPages && budget > 0) {
    const item = queue.shift()!;
    const key = normalize(item.url);
    if (seen.has(key)) continue;
    if (SKIP_EXT.test(item.url.pathname)) continue;
    seen.add(key);
    try {
      await assertPublicHttpUrl(item.url.href);
    } catch (err) {
      errors.push(`${item.url.href}: ${(err as Error).message}`);
      continue;
    }
    budget--;
    if (PDF_EXT.test(item.url.pathname) || DOC_EXT.test(item.url.pathname)) {
      const doc = PDF_EXT.test(item.url.pathname) ? await fetchPdf(item.url) : await fetchDocument(item.url);
      await politePause();
      if (doc && inScope(item.url, scope)) pages.push(doc);
      continue;
    }
    const fetched = await fetchPageOutcome(item.url);
    await politePause();
    const scoped = inScope(item.url, scope);
    if (!fetched.ok) {
      if (scoped) {
        const issue = issueFromOutcome(item.url, fetched);
        if (issue) issues.push(issue);
      }
      continue;
    }
    if (fetched.finalUrl.host !== origin.host) {
      if (scoped) issues.push({ url: item.url.href, status: fetched.status, finalUrl: fetched.finalUrl.href, reason: "redirect_offsite" });
      continue;
    }
    if (scoped) {
      const issue = issueFromOutcome(item.url, fetched);
      if (issue) issues.push(issue);
    }
    const { title, text, links, sections, jsonLdHtml } = extractText(fetched.html, fetched.finalUrl.href);
    if (text.length >= 80 && inScope(fetched.finalUrl, scope)) {
      pages.push({ url: fetched.finalUrl.href, title, text, sections });
      const ld = extractJsonLd(jsonLdHtml || fetched.html, fetched.finalUrl.href);
      for (const prod of productsToPages(ld.products, fetched.finalUrl.href)) {
        if (pages.length >= maxPages) break;
        if (!pages.some((p) => p.url === prod.url && p.title === prod.title)) pages.push(prod);
      }
    }
    if (item.depth < maxDepth) {
      for (const href of links) {
        const next = sameOrigin(origin, href);
        if (!next) continue;
        const nkey = normalize(next);
        if (!seen.has(nkey) && !SKIP_EXT.test(next.pathname) && !(scope?.exclude || []).some((x) => x.trim() && inScope(next, { exclude: [x] }) === false)) {
          queue.push({ url: next, depth: item.depth + 1 });
        }
      }
    }
  }

  if (pages.length < maxPages) {
    try {
      const extra = await discoverStructuredPages(origin, Math.min(maxPages - pages.length, PLAN_LIMITS[plan].maxPages));
      for (const p of extra) {
        if (pages.length >= maxPages) break;
        if (inScope(new URL(p.url), scope) && !pages.some((x) => x.url === p.url && x.title === p.title)) pages.push(p);
      }
    } catch {
      /* feeds are optional */
    }
  }

  const chunks: Array<TextChunk & { sourceUrl: string }> = [];
  for (const page of pages) {
    if (scope?.page_chunks) { chunks.push({ ...pageChunk(page), sourceUrl: page.url }); continue; }
    for (const chunk of chunkText(page.text, { title: page.title, url: page.url })) {
      chunks.push({ ...chunk, sourceUrl: page.url });
    }
  }

  return { pages, chunks, errors, issues: issues.slice(0, 40) };
}
