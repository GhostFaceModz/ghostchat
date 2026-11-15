import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/supabase.js";
import { effectiveBranding } from "../lib/usage.js";
import { botCardSvg, esc, hexColor, render } from "../lib/og.js";
import { rateLimit, clientIp } from "../lib/rateLimit.js";
import type { Site } from "../types.js";

const KEY = /^[A-Za-z0-9_-]{4,64}$/;
const BASE = (process.env.SHARE_BASE_URL || process.env.PUBLIC_URL || "https://ghostchat.pro").replace(/\/$/, ""); // canonical public origin for share links and cards

type ShareSite = Pick<Site, "name" | "url" | "greeting" | "plan" | "show_branding" | "site_key"> & { updated_at?: string; theme: { primary?: string } | null };
async function loadShareSite(key: string): Promise<ShareSite | null> {
  if (!KEY.test(key)) return null;
  const { data } = await getDb().from("ghostchat_sites").select("name, url, greeting, plan, show_branding, site_key, theme, updated_at").eq("site_key", key).maybeSingle();
  return (data as ShareSite) ?? null;
}
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

// Small in-memory cache: a card is re-drawn only when the bot changes (updated_at) or after an hour.
const cache = new Map<string, { at: number; png: Buffer }>();

export function shareRouter(repoRoot: string): Router {
  const r = Router();

  /** Per-bot link-preview card: "Chat with <bot>" in the bot's colour. */
  r.get("/og/:file", async (req, res) => {
    const key = String(req.params.file || "").replace(/\.png$/i, "");
    const rl = rateLimit(`og:${clientIp(req)}`, 60, 60_000);
    if (!rl.ok) return res.status(429).end();
    try {
      const site = await loadShareSite(key);
      if (!site) return res.redirect(302, "/og-image.png");
      const ck = `${key}:${site.updated_at}`;
      let hit = cache.get(ck);
      if (!hit || Date.now() - hit.at > 3_600_000) {
        const png = render(botCardSvg({ name: site.name, host: host(site.url), color: hexColor(site.theme?.primary), greeting: site.greeting, branding: effectiveBranding(site as unknown as Site) }), 1200);
        hit = { at: Date.now(), png };
        cache.set(ck, hit);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
      }
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
      res.send(hit.png);
    } catch (err) {
      console.error("og card failed:", (err as Error).message);
      res.redirect(302, "/og-image.png");
    }
  });

  /** Public "chat with us" page an owner can share; has its own preview card. */
  r.get("/c/:siteKey", async (req, res) => {
    const key = String(req.params.siteKey || "");
    const site = KEY.test(key) ? await loadShareSite(key).catch(() => null) : null;
    const name = site?.name || "GhostChat";
    const title = site ? `Chat with ${site.name}` : "Chat · GhostChat";
    const desc = (site?.greeting || `Ask ${name} anything. Answers in seconds, with a real person on hand when you need one.`).slice(0, 200);
    const color = hexColor(site?.theme?.primary);
    const url = `${BASE}/c/${encodeURIComponent(key)}`;
    const img = site ? `${BASE}/og/${encodeURIComponent(key)}.png` : `${BASE}/og-image.png`;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=300");
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="theme-color" content="${color}" />
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(name)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${img}" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: dark; --c: ${color}; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: Inter, system-ui, sans-serif; color: #f5f3ff; display: grid; place-items: center; padding: 32px 20px;
      background: radial-gradient(1000px 560px at 85% 0%, color-mix(in srgb, var(--c) 34%, transparent), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(103,232,249,.10), transparent 60%), #07040c; }
    .card { width: min(560px, 100%); background: rgba(18,10,32,.7); border: 1px solid rgba(196,181,253,.16); border-radius: 28px; padding: 36px 32px 28px; box-shadow: 0 30px 80px rgba(0,0,0,.4); text-align: center; }
    .host { display: inline-block; font-size: 13px; color: #c4b5fd; border: 1px solid rgba(196,181,253,.22); border-radius: 999px; padding: 4px 12px; margin-bottom: 14px; }
    h1 { font-family: Unbounded, sans-serif; font-weight: 700; font-size: clamp(26px, 6vw, 38px); margin: 0 0 10px; letter-spacing: -0.02em; }
    p { color: #c4b5fd; margin: 0 0 20px; line-height: 1.55; }
    .go { display: inline-block; border: 0; border-radius: 999px; padding: 12px 22px; background: var(--c); color: #fff; font: 600 15px Inter, sans-serif; cursor: pointer; }
    small { display: block; margin-top: 18px; color: rgba(245,243,255,.5); }
    small a { color: inherit; }
  </style>
</head>
<body>
  <main class="card">
    ${site ? `<span class="host">${esc(host(site.url))}</span>` : ""}
    <h1>${esc(title)}</h1>
    <p>${esc(desc)}</p>
    <button class="go" type="button" onclick="var h=document.querySelector('#ghostchat-host');var l=h&&h.shadowRoot&&h.shadowRoot.querySelector('.gc-launcher');if(l&&h.shadowRoot.querySelector('.gc-root').getAttribute('data-open')!=='true')l.click();">Start chatting</button>
    ${site && effectiveBranding(site as unknown as Site) ? `<small>Powered by <a href="${BASE}/?ref=share">GhostChat</a></small>` : ""}
  </main>
  ${site ? `<script src="/widget.js" data-id="${esc(key)}" data-open="true" data-share="true"></script>` : ""}
</body>
</html>`);
  });

  // Per-page preview text for routes that reuse another page's HTML (e.g. /pricing serves the landing page).
  const landing = (() => { let html: string | null = null; return () => (html ??= fs.readFileSync(path.join(repoRoot, "public", "index.html"), "utf8")); })();
  r.get("/pricing", (_req, res) => {
    const t = "GhostChat pricing — free to start, upgrade when you grow";
    const d = "Start free. Pro and Business add more messages, live human handoff, your own branding and analytics. Cancel anytime.";
    let html = landing()
      .replace(/<title>[^<]*<\/title>/, `<title>Pricing · GhostChat</title>`)
      .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(d)}`)
      .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(t)}`)
      .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${esc(t)}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(d)}`)
      .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${esc(d)}`)
      .replace(/(<meta property="og:url" content=")[^"]*/, `$1${BASE}/pricing`)
      .replace(/(<link rel="canonical" href=")[^"]*/, `$1${BASE}/pricing`);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(html);
  });
  return r;
}
