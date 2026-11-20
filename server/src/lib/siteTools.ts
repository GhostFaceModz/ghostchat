import { assertPublicHttpUrl } from "./ssrf.js";
import type { IntentFilters, IntentKind } from "./intent.js";

/**
 * "Site search tools": an owner connects a JSON search endpoint (URL template) or a catalogue feed
 * (one JSON file listing everything) plus a field mapping. The bot calls it when the visitor's intent fits
 * and shows the results as cards. Only items the tool returned are ever shown.
 */
export type ToolFields = { title: string; url: string; image?: string; subtitle?: string; rating?: string; description?: string; year?: string };
export type SearchTool = {
  id: string;
  name: string;
  kind: "json" | "feed";
  url_template: string;
  items_path: string;
  fields: ToolFields;
  intents: IntentKind[];
  button_label: string;
  enabled: boolean;
};
export type ToolItem = { title: string; url: string; image: string | null; subtitle: string | null; rating: number | null; description: string | null; year: number | null };

export const PLACEHOLDERS = ["query", "genre", "mood", "year_from", "year_to", "similar_to", "type", "language", "actors", "rating", "keyword", "sort"] as const;
const TOOL_INTENTS: IntentKind[] = ["recommend", "find", "howto", "account", "support", "other"];
const MAX_TOOLS = 3;
const MAX_BYTES = 1_500_000;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const path = (v: unknown) => s(v, 160).replace(/[^\w.$\[\]{}\/:-]/g, "");

/** A field is a dot path ("poster.url") or a small template built from item fields ("/title/{media_type}/{id}"). */
export function fieldValue(item: unknown, spec: string | undefined): unknown {
  if (!spec) return undefined;
  if (!spec.includes("{")) return getPath(item, spec);
  return spec.replace(/\{([\w.\[\]]+)\}/g, (_, p: string) => { const v = getPath(item, p); return v == null ? "" : encodeURIComponent(String(v)); });
}

/** Validate tools from the dashboard. Throws with a friendly message on a bad URL. */
export async function normalizeTools(input: unknown): Promise<SearchTool[]> {
  if (!Array.isArray(input)) return [];
  const out: SearchTool[] = [];
  for (const raw of input.slice(0, MAX_TOOLS)) {
    const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const f = (t.fields && typeof t.fields === "object" ? t.fields : {}) as Record<string, unknown>;
    const url_template = s(t.url_template, 600);
    if (!url_template) continue;
    const probe = fillTemplate(url_template, { query: "test" });
    const u = await assertPublicHttpUrl(probe);
    if (u.protocol !== "https:") throw new Error("Search tools must use https");
    const fields: ToolFields = { title: path(f.title) || "title", url: path(f.url) || "url" };
    for (const k of ["image", "subtitle", "rating", "description", "year"] as const) { const v = path(f[k]); if (v) fields[k] = v; }
    const intents = (Array.isArray(t.intents) ? t.intents : ["recommend", "find"]).filter((x): x is IntentKind => TOOL_INTENTS.includes(x as IntentKind));
    out.push({
      id: s(t.id, 40).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2, 10),
      name: s(t.name, 60) || "Site search",
      kind: t.kind === "feed" ? "feed" : "json",
      url_template,
      items_path: path(t.items_path),
      fields,
      intents: intents.length ? intents : ["recommend", "find"],
      button_label: s(t.button_label, 40) || "Open",
      enabled: t.enabled !== false,
    });
  }
  return out;
}

export function toolsFor(site: { search_tools?: unknown }): SearchTool[] {
  return Array.isArray(site.search_tools) ? (site.search_tools as SearchTool[]).filter((t) => t && t.enabled !== false && t.url_template) : [];
}

/** Fill {placeholders}; query-string params whose value ends up empty are dropped entirely. */
export function fillTemplate(template: string, f: IntentFilters): string {
  const val = (k: string): string => {
    const src = k === "keyword" && (f as IntentFilters).mood != null ? "mood" : k === "rating" && (f as IntentFilters).rating != null ? "rating" : k;
    const v = (f as Record<string, unknown>)[src];
    if (Array.isArray(v)) return v.join(",");
    return v == null ? "" : String(v);
  };
  const filled = template.replace(/\{(\w+)\}/g, (_, k: string) => ((PLACEHOLDERS as readonly string[]).includes(k) ? encodeURIComponent(val(k)) : ""));
  const q = filled.indexOf("?");
  if (q < 0) return filled;
  const kept = filled.slice(q + 1).split("&").filter((p) => p && !/=$/.test(p));
  return filled.slice(0, q) + (kept.length ? `?${kept.join("&")}` : "");
}

/** "results", "data.items", "hits.0.docs", "" (the body itself). */
export function getPath(obj: unknown, p: string): unknown {
  if (!p || p === "$") return obj;
  let cur: unknown = obj;
  for (const key of p.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const httpUrl = (v: unknown, base: string): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  try { const u = new URL(v.trim(), base); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
};

export function mapItems(body: unknown, tool: Pick<SearchTool, "items_path" | "fields">, base: string): ToolItem[] {
  const list = getPath(body, tool.items_path);
  const arr = Array.isArray(list) ? list : Array.isArray(body) ? body : [];
  const out: ToolItem[] = [];
  for (const it of arr.slice(0, 200)) {
    const title = s(String(fieldValue(it, tool.fields.title) ?? ""), 120);
    const url = httpUrl(fieldValue(it, tool.fields.url), base);
    if (!title || !url) continue;
    const num = (k?: string) => { if (!k) return null; const n = Number(fieldValue(it, k)); return Number.isFinite(n) ? n : null; };
    const txt = (k: string | undefined, n: number) => (k ? s(String(fieldValue(it, k) ?? ""), n) || null : null);
    const rating = num(tool.fields.rating);
    let yr = num(tool.fields.year);
    if (yr == null && tool.fields.year) { const m = String(fieldValue(it, tool.fields.year) ?? "").match(/\b(18|19|20)\d{2}\b/); yr = m ? Number(m[0]) : null; }
    out.push({
      title, url,
      image: tool.fields.image ? httpUrl(fieldValue(it, tool.fields.image), base) : null,
      subtitle: txt(tool.fields.subtitle, 80),
      rating: rating != null ? Math.round(rating * 10) / 10 : null,
      description: txt(tool.fields.description, 300),
      year: yr != null && yr > 1800 && yr < 2200 ? Math.trunc(yr) : null,
    });
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Feeds have no search, so score each item against the visitor's words. */
export function filterFeed(items: ToolItem[], f: IntentFilters, limit = 8): ToolItem[] {
  const terms = norm([f.query, f.genre, f.mood, f.similar_to, ...(f.actors || [])].filter(Boolean).join(" ")).split(" ").filter((w) => w.length > 2);
  const scored = items
    .filter((it) => (f.year_from == null || it.year == null || it.year >= f.year_from) && (f.year_to == null || it.year == null || it.year <= f.year_to))
    .map((it) => {
      const hay = norm(`${it.title} ${it.subtitle || ""} ${it.description || ""}`);
      const t = norm(it.title);
      let score = 0;
      for (const w of terms) { if (t.includes(w)) score += 3; else if (hay.includes(w)) score += 1; }
      if (f.similar_to && norm(f.similar_to) === t) score = -1; // never recommend the title they compared against
      return { it, score };
    })
    .filter((x) => (terms.length ? x.score > 0 : x.score >= 0));
  return scored.sort((a, b) => b.score - a.score || (b.it.rating || 0) - (a.it.rating || 0)).slice(0, limit).map((x) => x.it);
}

const feedCache = new Map<string, { at: number; body: unknown }>();
async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  await assertPublicHttpUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetcher(url, { signal: ctrl.signal, redirect: "error", headers: { accept: "application/json", "user-agent": "GhostChatBot/1.0 (+site search tool)" } });
    if (!res.ok) throw new Error(`Search tool returned ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("Search tool response is too large");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export type ToolSearch = { items: ToolItem[]; note: string | null; match: "exact" | "relaxed" | null; url: string };

function metaFrom(body: unknown): Pick<ToolSearch, "note" | "match"> {
  const o = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 240) : null;
  const match = o.match === "relaxed" || o.match === "exact" ? o.match : (note ? "relaxed" : null);
  return { note, match };
}

export async function runSearch(tool: SearchTool, f: IntentFilters, fetcher: typeof fetch = fetch, limit = 8): Promise<ToolSearch> {
  if (tool.kind === "feed") {
    const url = tool.url_template;
    const hit = feedCache.get(url);
    let body = hit && Date.now() - hit.at < 10 * 60_000 ? hit.body : null;
    if (!body) { body = await fetchJson(url, fetcher); feedCache.set(url, { at: Date.now(), body }); if (feedCache.size > 50) feedCache.delete(feedCache.keys().next().value!); }
    return { items: filterFeed(mapItems(body, tool, url), f, limit), note: null, match: null, url };
  }
  const url = fillTemplate(tool.url_template, f);
  const body = await fetchJson(url, fetcher);
  const seen = new Set<string>();
  const items = mapItems(body, tool, url).filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true))).slice(0, limit);
  return { items, url, ...metaFrom(body) };
}

export async function runTool(tool: SearchTool, f: IntentFilters, fetcher: typeof fetch = fetch, limit = 8): Promise<ToolItem[]> {
  return (await runSearch(tool, f, fetcher, limit)).items;
}

/** Progressively drop or widen filters when an exact catalogue search is empty. */
export function relaxFilters(f: IntentFilters): Array<{ filters: IntentFilters; kind: string }> {
  const out: Array<{ filters: IntentFilters; kind: string }> = [{ filters: { ...f }, kind: "exact" }];
  const push = (kind: string, filters: IntentFilters) => {
    const key = JSON.stringify(filters);
    if (out.some((x) => JSON.stringify(x.filters) === key)) return;
    out.push({ kind, filters });
  };
  if (f.rating != null) { const { rating: _r, ...rest } = f; push("drop_rating", rest); }
  if (f.year_from != null || f.year_to != null) {
    const widen = { ...f };
    if (f.year_from != null) widen.year_from = f.year_from - 2;
    if (f.year_to != null) widen.year_to = f.year_to + 1;
    push("wider_year", widen);
  }
  if (f.mood) { const { mood: _m, ...rest } = f; push("drop_mood", rest); }
  if (f.year_from != null || f.year_to != null) {
    const rest = { ...f }; delete rest.year_from; delete rest.year_to;
    push("drop_year", rest);
  }
  const core: IntentFilters = {};
  if (f.genre) core.genre = f.genre;
  if (f.type) core.type = f.type;
  if (f.query) core.query = f.query;
  if (Object.keys(core).length) push("broad", core);
  return out;
}

export function relaxedNote(kind: string, f: IntentFilters): string {
  const year = f.year_from && f.year_to && f.year_from === f.year_to ? String(f.year_from) : (f.year_from && f.year_to ? `${f.year_from}–${f.year_to}` : (f.year_from || f.year_to || ""));
  if (kind === "wider_year") return year ? `I couldn't find an exact ${year} match, so here are close titles from nearby years.` : "No exact year matches, so here are nearby years.";
  if (kind === "drop_mood") return f.mood ? `I couldn't find ${f.mood} titles${year ? ` from ${year}` : ""}, so here are close matches without that mood.` : "Here are close matches with a wider search.";
  if (kind === "drop_year") return year ? `I couldn't find that mix in ${year}, so here are matches from other years.` : "Here are matches from a wider search.";
  if (kind === "drop_rating") return "Nothing at that rating, so here are solid matches without the rating filter.";
  if (kind === "broad") return "No exact matches, so here are the closest titles from the catalogue.";
  return "No exact matches, so here are the closest titles from the catalogue.";
}

export function pickTool(tools: SearchTool[], intent: IntentKind): SearchTool | null {
  return tools.find((t) => t.intents.includes(intent)) || null;
}
