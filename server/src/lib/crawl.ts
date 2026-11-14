import * as cheerio from "cheerio";
import { config, PLAN_LIMITS, type Plan } from "../config.js";
import { chunkText, type TextChunk } from "./chunk.js";
import { assertPublicHttpUrl, sameOrigin } from "./ssrf.js";

const SKIP_EXT = /\.(pdf|zip|gz|tar|rar|7z|png|jpe?g|gif|webp|svg|ico|mp[34]|wav|avi|mov|wmv|mkv|css|js|mjs|map|woff2?|ttf|eot|json|xml)$/i;

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
};

export type CrawlResult = {
  pages: CrawledPage[];
  chunks: Array<TextChunk & { sourceUrl: string }>;
  errors: string[];
};

function extractText(html: string, pageUrl: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, iframe, svg, canvas, form, header").remove();
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    pageUrl;
  const parts: string[] = [];
  $("h1, h2, h3, h4, p, li, dt, dd, article, section, td, th, blockquote, pre").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length >= 20) parts.push(t);
  });
  let text = parts.join("\n\n");
  if (text.length < 80) {
    text = $("body").text().replace(/\s+/g, " ").trim();
  }
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });
  return { title, text, links };
}

async function fetchPage(url: URL): Promise<{ html: string; finalUrl: URL } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      },
    });
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !ctype.includes("html")) return null;
    const html = await res.text();
    if (html.length > 2_000_000) return null;
    const finalUrl = new URL(res.url || url.href);
    return { html, finalUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}


async function discoverSitemapUrls(origin: URL, maxUrls: number): Promise<URL[]> {
  const targets = [new URL("/sitemap.xml", origin), new URL("/sitemap_index.xml", origin)];
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

export async function crawlSite(startUrl: string, plan: Plan): Promise<CrawlResult> {
  const origin = await assertPublicHttpUrl(startUrl);
  const maxPages = Math.min(config.crawlMaxPages, PLAN_LIMITS[plan].maxPages);
  const maxDepth = config.crawlMaxDepth;
  const queue: Array<{ url: URL; depth: number }> = [{ url: origin, depth: 0 }];
  const seen = new Set<string>();
  for (const sitemapUrl of await discoverSitemapUrls(origin, maxPages)) {
    queue.push({ url: sitemapUrl, depth: 1 });
  }
  const pages: CrawledPage[] = [];
  const errors: string[] = [];

  const normalize = (u: URL) => {
    const copy = new URL(u.href);
    copy.hash = "";
    if (copy.pathname.endsWith("/")) copy.pathname = copy.pathname.slice(0, -1) || "/";
    return copy.href;
  };

  while (queue.length && pages.length < maxPages) {
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
    const fetched = await fetchPage(item.url);
    if (!fetched) continue;
    if (fetched.finalUrl.host !== origin.host) continue;
    const { title, text, links } = extractText(fetched.html, fetched.finalUrl.href);
    if (text.length >= 80) {
      pages.push({ url: fetched.finalUrl.href, title, text });
    }
    if (item.depth < maxDepth) {
      for (const href of links) {
        const next = sameOrigin(origin, href);
        if (!next) continue;
        const nkey = normalize(next);
        if (!seen.has(nkey) && !SKIP_EXT.test(next.pathname)) {
          queue.push({ url: next, depth: item.depth + 1 });
        }
      }
    }
  }

  const chunks: Array<TextChunk & { sourceUrl: string }> = [];
  for (const page of pages) {
    for (const chunk of chunkText(page.text, { title: page.title, url: page.url })) {
      chunks.push({ ...chunk, sourceUrl: page.url });
    }
  }

  return { pages, chunks, errors };
}
