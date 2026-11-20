import type { IntentFilters } from "./intent.js";
import type { ToolItem } from "./siteTools.js";

const TMDB = "https://api.themoviedb.org/3";

export function tmdbApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TMDB_API_KEY || env.TMDB_READ_ACCESS_TOKEN || "").trim();
}

/** Direct TMDB is only used to build watch links on a Flix-style site. Other catalogues keep their own URLs. */
export function supportsDirectTmdb(siteUrl?: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!tmdbApiKey(env) || !siteUrl) return false;
  try {
    return /ghostflix|flix/i.test(new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

export function shouldLookupSimilar(message: string, filters: IntentFilters): boolean {
  if (!filters.similar_to) return false;
  if (/\bgames?\b/i.test(message) && !/\b(movies?|films?|shows?|series|tv)\b/i.test(message)) return false;
  return true;
}

function originOf(siteUrl?: string | null): string {
  if (!siteUrl) return "";
  try {
    const u = new URL(siteUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return siteUrl.replace(/\/$/, "");
  }
}

function normTitle(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

type TmdbRow = {
  id?: number;
  title?: string;
  name?: string;
  media_type?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};

async function tmdbGet(url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<{ results?: TmdbRow[] } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetcher(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as { results?: TmdbRow[] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rowTitle(row: TmdbRow): string {
  return String(row.title || row.name || "").trim();
}

function rowYear(row: TmdbRow): number | null {
  const raw = String(row.release_date || row.first_air_date || "");
  const year = Number(raw.slice(0, 4));
  return year >= 1880 && year <= 2100 ? year : null;
}

/** Search TMDB for `title`, then pull /recommendations (and /similar if that's empty). */
export async function tmdbSimilarTitles(
  title: string,
  opts: { type?: "movie" | "tv"; siteUrl?: string | null; apiKey?: string; fetcher?: typeof fetch } = {},
): Promise<ToolItem[]> {
  const key = (opts.apiKey ?? tmdbApiKey()).trim();
  if (!key || !title.trim()) return [];
  const fetcher = opts.fetcher ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  const auth = new URLSearchParams();
  if (key.split(".").length >= 3) headers.authorization = `Bearer ${key}`;
  else auth.set("api_key", key);
  const q = new URLSearchParams(auth);
  q.set("query", title.trim());
  q.set("include_adult", "false");
  const searchPath = opts.type === "tv" ? "/search/tv" : opts.type === "movie" ? "/search/movie" : "/search/multi";
  const search = await tmdbGet(`${TMDB}${searchPath}?${q}`, headers, fetcher);
  const rows = Array.isArray(search?.results) ? search.results : [];
  const want = normTitle(title);
  const seed = rows
    .map((row) => ({ row, name: rowTitle(row), media: row.media_type || opts.type || "movie" }))
    .filter((hit) => hit.name && (!opts.type || hit.media === opts.type))
    .sort((a, b) => Number(normTitle(b.name) === want) - Number(normTitle(a.name) === want) || (b.row.vote_count || 0) - (a.row.vote_count || 0))[0];
  if (!seed?.row.id) return [];
  const media = seed.media === "tv" ? "tv" : "movie";
  const rec = await tmdbGet(`${TMDB}/${media}/${seed.row.id}/recommendations?${auth}`, headers, fetcher);
  let list = Array.isArray(rec?.results) ? rec.results : [];
  if (!list.length) {
    const similar = await tmdbGet(`${TMDB}/${media}/${seed.row.id}/similar?${auth}`, headers, fetcher);
    list = Array.isArray(similar?.results) ? similar.results : [];
  }
  const origin = originOf(opts.siteUrl);
  const seen = new Set<number>([seed.row.id]);
  const items: ToolItem[] = [];
  for (const row of list) {
    if (!row.id || seen.has(row.id)) continue;
    const name = rowTitle(row);
    if (!name) continue;
    seen.add(row.id);
    const rating = Number(row.vote_average);
    items.push({
      title: name,
      url: origin ? `${origin}/title/${media}/${row.id}` : `https://www.themoviedb.org/${media}/${row.id}`,
      image: row.poster_path ? `https://image.tmdb.org/t/p/w342${row.poster_path}` : null,
      subtitle: null,
      rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
      description: row.overview ? String(row.overview).replace(/\s+/g, " ").trim().slice(0, 220) : null,
      year: rowYear(row),
    });
    if (items.length >= 6) break;
  }
  return items;
}

/** A short list with markdown links, ratings, and one-line descriptions. No model call. */
export function formatSimilarList(seed: string, items: ToolItem[]): string {
  const lines = items.slice(0, 5).map((it) => {
    const year = it.year ? ` (${it.year})` : "";
    const rating = it.rating ? ` · ${it.rating}/10` : "";
    const desc = it.description ? ` — ${it.description.replace(/\s+/g, " ").trim().slice(0, 140)}` : "";
    return `- [${it.title}](${it.url})${year}${rating}${desc}`;
  });
  const title = seed.trim() || "that";
  return `If you liked ${title}, these are close matches:\n\n${lines.join("\n")}`;
}
