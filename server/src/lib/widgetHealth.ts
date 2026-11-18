import { fetchPage } from "./crawl.js";
import { assertPublicHttpUrl } from "./ssrf.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";

export type SnippetDetection = {
  widgetScript: boolean;
  siteKey: boolean;
  found: boolean;
};

export type InstallStatus = "active" | "installed" | "missing" | "unknown";

export type InstallHealth = {
  status: InstallStatus;
  label: string;
  detail: string;
  lastSeenAt: string | null;
  lastPage: string | null;
  checkedAt: string | null;
  homepage: string | null;
};

const ACTIVE_MS = 7 * 86_400_000;
const SEE_THROTTLE_MS = 2 * 60_000;

export function detectSnippet(html: string, siteKey: string): SnippetDetection {
  const key = String(siteKey || "").trim();
  const widgetScript = /(?:src\s*=\s*["'][^"']*)?widget\.js(?:\?[^"']*)?["']/i.test(html) || /\/widget\.js/i.test(html);
  const siteKeyFound = Boolean(key) && html.includes(key);
  return { widgetScript, siteKey: siteKeyFound, found: widgetScript && siteKeyFound };
}

export function pageHost(url: string | null | undefined): string | null {
  try { return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; }
}

export function pageMatchesSite(siteUrl: string | null | undefined, pageUrl: string | null | undefined): boolean {
  const a = pageHost(siteUrl);
  const b = pageHost(pageUrl);
  return Boolean(a && b && (a === b || b.endsWith("." + a) || a.endsWith("." + b)));
}

export function classifyInstall(opts: {
  lastSeenAt: string | null;
  lastPage: string | null;
  siteUrl: string | null;
  snippet: SnippetDetection | null;
  fetched: boolean;
  now?: Date;
}): { status: InstallStatus; label: string; detail: string } {
  const now = opts.now ?? new Date();
  const seen = opts.lastSeenAt ? new Date(opts.lastSeenAt).getTime() : 0;
  const recently = seen && now.getTime() - seen < ACTIVE_MS;
  if (recently) {
    const where = opts.lastPage && pageMatchesSite(opts.siteUrl, opts.lastPage) ? opts.lastPage : opts.lastPage;
    return {
      status: "active",
      label: "Installed and active",
      detail: where ? `The widget loaded on ${where}` : "The widget has loaded on a visitor's page in the last 7 days.",
    };
  }
  if (opts.snippet?.found) {
    return {
      status: "installed",
      label: "Snippet found, waiting for a visitor",
      detail: "The homepage HTML includes your site key and widget.js, but the bubble hasn't loaded for a visitor yet.",
    };
  }
  if (opts.snippet?.widgetScript && !opts.snippet.siteKey) {
    return {
      status: "installed",
      label: "A widget script is on the homepage",
      detail: "widget.js is present, but this site key was not found in the HTML. Check the data-id on the snippet.",
    };
  }
  if (!opts.fetched) {
    return {
      status: "unknown",
      label: "Couldn't check the homepage",
      detail: recently ? "The widget was seen recently, but the homepage could not be fetched." : "The homepage could not be fetched (blocked, login-only, or JavaScript-rendered). Paste the snippet, then open the site in a browser to confirm.",
    };
  }
  return {
    status: "missing",
    label: "Snippet not found on the homepage",
    detail: "We fetched the homepage and did not find widget.js with this site key. If the chat is only on some pages, or the theme is JavaScript-rendered, open a page with the snippet to mark it active.",
  };
}

export function clipPageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    const href = u.href;
    return href.length > 500 ? href.slice(0, 500) : href;
  } catch {
    return null;
  }
}

export async function recordWidgetSeen(siteId: string, pageUrl: string | null, previous?: { last_widget_seen_at?: string | null; last_widget_page?: string | null }): Promise<void> {
  const now = Date.now();
  const last = previous?.last_widget_seen_at ? new Date(previous.last_widget_seen_at).getTime() : 0;
  const samePage = (previous?.last_widget_page || null) === pageUrl;
  if (last && now - last < SEE_THROTTLE_MS && samePage) return;
  await getDb().from("ghostchat_sites").update({
    last_widget_seen_at: new Date(now).toISOString(),
    last_widget_page: pageUrl,
    updated_at: new Date(now).toISOString(),
  }).eq("id", siteId);
}

export async function checkInstallHealth(site: Site, opts: { force?: boolean } = {}): Promise<InstallHealth> {
  const existing = (site.last_install_check && typeof site.last_install_check === "object") ? site.last_install_check as Partial<InstallHealth> & { snippet?: SnippetDetection; fetched?: boolean } : null;
  const lastCheck = site.last_install_check_at ? new Date(site.last_install_check_at).getTime() : 0;
  const stale = !lastCheck || Date.now() - lastCheck > 6 * 3600_000;
  let snippet: SnippetDetection | null = existing?.snippet ?? null;
  let fetched = existing?.fetched ?? false;
  let homepage: string | null = existing?.homepage ?? site.url ?? null;
  if (opts.force || stale) {
    snippet = null;
    fetched = false;
    try {
      const url = await assertPublicHttpUrl(site.url);
      homepage = url.href;
      const page = await fetchPage(url, 8000);
      if (page) {
        fetched = true;
        homepage = page.finalUrl.href;
        snippet = detectSnippet(page.html, site.site_key);
      }
    } catch {
      fetched = false;
    }
  }
  const classified = classifyInstall({
    lastSeenAt: site.last_widget_seen_at || null,
    lastPage: site.last_widget_page || null,
    siteUrl: site.url,
    snippet,
    fetched,
  });
  const health: InstallHealth = {
    ...classified,
    lastSeenAt: site.last_widget_seen_at || null,
    lastPage: site.last_widget_page || null,
    checkedAt: (opts.force || stale) ? new Date().toISOString() : (site.last_install_check_at || null),
    homepage,
  };
  if (opts.force || stale) {
    await getDb().from("ghostchat_sites").update({
      last_install_check_at: health.checkedAt,
      last_install_check: { ...health, snippet, fetched },
    }).eq("id", site.id);
  }
  return health;
}
