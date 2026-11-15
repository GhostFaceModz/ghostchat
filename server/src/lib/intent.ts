import { completeChat } from "./ai.js";
import { DEFAULT_CHAT_MODEL } from "./models.js";

export type IntentKind = "recommend" | "find" | "howto" | "account" | "support" | "other";
export type IntentFilters = {
  query?: string;
  genre?: string;
  mood?: string;
  year_from?: number;
  year_to?: number;
  similar_to?: string;
  type?: "movie" | "tv";
  actors?: string[];
  language?: string;
  rating?: number;
};
export type Intent = { intent: IntentKind; filters: IntentFilters; clarify: string | null; options: string[]; source: "ai" | "rules" };

const KINDS: IntentKind[] = ["recommend", "find", "howto", "account", "support", "other"];
const LANGS: Record<string, string> = { english: "en", french: "fr", spanish: "es", german: "de", italian: "it", japanese: "ja", korean: "ko", hindi: "hi", chinese: "zh", mandarin: "zh", portuguese: "pt", swedish: "sv", danish: "da", norwegian: "no", turkish: "tr", russian: "ru", polish: "pl", dutch: "nl", thai: "th", arabic: "ar" };

const str = (v: unknown, n = 80) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const year = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1870 && n <= 2100 ? n : undefined; };

/** Validate whatever the model returned into a safe Intent (unknown keys dropped, values clipped). */
export function normalizeIntent(raw: unknown, source: Intent["source"] = "ai"): Intent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f = (o.filters && typeof o.filters === "object" ? o.filters : o) as Record<string, unknown>;
  const intent = KINDS.includes(o.intent as IntentKind) ? (o.intent as IntentKind) : "other";
  const filters: IntentFilters = {};
  for (const k of ["query", "genre", "mood", "similar_to"] as const) { const v = str(f[k]); if (v) filters[k] = v; }
  const yf = year(f.year_from), yt = year(f.year_to);
  if (yf) filters.year_from = yf;
  if (yt) filters.year_to = yt;
  if (f.type === "movie" || f.type === "tv") filters.type = f.type;
  const actors = (Array.isArray(f.actors) ? f.actors : typeof f.actors === "string" ? [f.actors] : []).map((a) => str(a, 60)).filter(Boolean).slice(0, 3);
  if (actors.length) filters.actors = actors;
  const lang = str(f.language, 20).toLowerCase();
  if (/^[a-z]{2}$/.test(lang)) filters.language = lang; else if (LANGS[lang]) filters.language = LANGS[lang];
  const rating = Number(f.rating ?? f.rating_min);
  if (Number.isFinite(rating) && rating >= 1 && rating <= 10) filters.rating = Math.round(rating * 10) / 10;
  const clarify = intent === "recommend" && !hasFilters(filters) ? str(o.clarify, 140) || null : null;
  const options = clarify && Array.isArray(o.options) ? o.options.map((x) => str(x, 40)).filter(Boolean).slice(0, 3) : [];
  return { intent, filters, clarify, options, source };
}

export const hasFilters = (f: IntentFilters) => Object.keys(f).length > 0;

/** Cheap fallback when the model is unavailable: keyword rules good enough to route to the right tool. */
const GENRE_WORD = /\b(horror|scary|comedy|funny|romance|romantic|rom-?com|thriller|sci-?fi|science fiction|action|drama|documentary|animated|anime|fantasy|crime|mystery|western|war|family|kids)\b/;
const MOOD_WORD = /\b(stoner|weed|cannabis|trippy|psychedelic|feel-?good|wholesome|gory|campy|cozy|slasher|superhero|christmas|holiday|found[ -]?footage)\b/;
const GENERIC_LIKE = /^(?:a|an|the)?\s*(?:good|great|fun|funny|nice|cool|new)?\s*(?:stoner|weed|horror|scary|comedy|funny|romance|romantic|thriller|sci-?fi|action|drama|documentary|animated|anime|fantasy|crime|mystery|family|kids|trippy|gory|campy|cozy|slasher|superhero|christmas|holiday)?\s*(?:movie|film|show|series|comedy)?s?\s*$/i;

function captureTitle(message: string): string | undefined {
  const like = message.match(/\b(?:like|similar to|such as)\s+["“']?([^"”'?.!,]{2,60})/i);
  if (!like) return undefined;
  const title = like[1].replace(/\b(please|pls|thanks)\b.*$/i, "").trim();
  if (!title || GENERIC_LIKE.test(title) || /^(?:a|an)\s+/i.test(title)) return undefined;
  return title;
}

function captureYears(m: string, f: IntentFilters) {
  const between = m.match(/\bbetween\s+((?:19|20)\d{2})\s+and\s+((?:19|20)\d{2})\b/);
  if (between) { f.year_from = Number(between[1]); f.year_to = Number(between[2]); return; }
  const range = m.match(/\b((?:19|20)\d{2})\s*(?:-|–|to|through)\s*((?:19|20)\d{2})\b/);
  if (range) { f.year_from = Number(range[1]); f.year_to = Number(range[2]); return; }
  const dec = m.match(/\b(?:19|20)?(\d)0s\b/);
  if (dec) { const d = Number(dec[1]); const base = d >= 3 ? 1900 + d * 10 : 2000 + d * 10; f.year_from = base; f.year_to = base + 9; return; }
  const y = m.match(/\b(?:(?:made|released|from|in|year)\s+)?(?:in\s+)?((?:19|20)\d{2})\b/);
  if (y) { f.year_from = Number(y[1]); f.year_to = Number(y[1]); }
}

export function ruleIntent(message: string): Intent {
  const m = message.toLowerCase();
  const f: IntentFilters = {};
  const like = captureTitle(message);
  if (like) f.similar_to = like;
  const g = m.match(GENRE_WORD);
  if (g) f.genre = g[1];
  const mood = m.match(MOOD_WORD);
  if (mood) f.mood = mood[1].replace(/\s+/g, " ");
  if (/\b(series|tv|show)\b/.test(m)) f.type = "tv"; else if (/\b(film|movie)s?\b/.test(m)) f.type = "movie";
  captureYears(m, f);
  const rated = m.match(/\b(?:rated\s+|rating\s+|at least\s+|over\s+|above\s+|)\s*(\d(?:\.\d)?)\s*(?:\+|stars?|\/10)\b/);
  if (rated) { const n = Number(rated[1]); if (n >= 1 && n <= 10) f.rating = n; }
  let intent: IntentKind = "other";
  const rec = /\b(recommend|suggest|something to watch|what should i watch|any good|similar to|in the mood for)\b/.test(m)
    || /\bfind me (?:a|an|some|good)\b/.test(m)
    || (/\b(find|search)\b/.test(m) && !!(f.genre || f.mood || f.year_from) && !f.similar_to);
  if (rec && (f.genre || f.mood || f.similar_to || f.year_from || /\b(watch|film|movie|show|series)\b/.test(m))) intent = "recommend";
  else if (/\b(find|search|is there|do you have|where can i (?:watch|find))\b/.test(m)) {
    intent = "find";
    f.query = message.replace(/^.*?\b(find|search for|search|is there|do you have|where can i (?:watch|find))\b/i, "").replace(/[?.!]+$/, "").trim().slice(0, 80) || undefined;
    if (!f.query) delete f.query;
  }
  else if (/\b(how (?:do|can|to)|where is|can i)\b/.test(m)) intent = "howto";
  else if (/\b(password|log ?in|sign ?in|account|subscription|billing|refund)\b/.test(m)) intent = "account";
  else if (/\b(broken|not working|error|bug|help me|support)\b/.test(m)) intent = "support";
  return { intent, filters: f, clarify: null, options: [], source: "rules" };
}

/** Pull the first JSON object out of a model reply. */
export function parseJsonObject(raw: string): unknown {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
}

const SYSTEM = `You classify a website visitor's chat message. Reply with ONE JSON object only:
{"intent":"recommend|find|howto|account|support|other","filters":{"query":string,"genre":string,"mood":string,"year_from":number,"year_to":number,"similar_to":string,"type":"movie|tv","actors":[string],"language":string,"rating":number},"clarify":string|null,"options":[string]}
- recommend: wants suggestions, including "find me a good comedy" or "a 2025 stoner movie". find: looking for a specific named title/product/page (put the name in query). howto: how to use the site. account: login, billing, subscription. support: something is broken. other: anything else.
- Only include filters the visitor actually stated or clearly implied ("90s" -> year_from 1990, year_to 1999; "2025" / "made in 2025" -> year_from and year_to 2025; "scary" -> genre "horror"; "stoner" / "trippy" / "feel-good" -> mood, not similar_to; "series" -> type "tv"; "rated 7+" -> rating 7). similar_to is only a named title ("like Hereditary"), never "like a stoner movie".
- Omit unknown filters. Do not dump the whole sentence into query when genre/mood/year will do.
- clarify: ONE short friendly question, only if intent is recommend and the request is truly vague (no genre, mood, title, year or type at all). Otherwise null.
- options: only with clarify, 2-3 short answers the visitor could tap (under 30 characters each), fitting this site.`;

export async function classifyIntent(message: string, history: Array<{ role: "user" | "assistant"; content: string }> = []): Promise<Intent> {
  try {
    const recent = history.slice(-4).map((h) => `${h.role}: ${h.content.slice(0, 300)}`).join("\n");
    const raw = await completeChat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${recent ? `Recent chat:\n${recent}\n\n` : ""}Message: ${message.slice(0, 600)}` },
      ],
      { maxTokens: 220, temperature: 0, json: true, fast: true, site: { chat_model: process.env.INTENT_MODEL || DEFAULT_CHAT_MODEL } },
    );
    const parsed = parseJsonObject(raw);
    if (parsed) {
      const ai = normalizeIntent(parsed, "ai");
      const rules = ruleIntent(message);
      // Small models sometimes answer "other"/"find" for a clear recommendation: trust the keyword rules then.
      if (rules.intent === "recommend" && (ai.intent === "other" || ai.intent === "find")) {
        return { ...rules, filters: { ...ai.filters, ...rules.filters }, source: "rules" };
      }
      if (ai.intent === "other" && rules.intent !== "other") return { ...rules, source: "rules" };
      const filters = { ...rules.filters, ...ai.filters };
      for (const k of Object.keys(rules.filters) as (keyof IntentFilters)[]) {
        if (filters[k] == null && rules.filters[k] != null) (filters as IntentFilters)[k] = rules.filters[k] as never;
      }
      if (hasFilters(filters)) return { ...ai, filters, clarify: null, options: [] };
      if (ai.intent === rules.intent && !hasFilters(ai.filters) && hasFilters(rules.filters)) return { ...ai, filters: rules.filters, clarify: null, options: [] };
      return ai;
    }
  } catch (err) {
    console.warn("intent fallback:", (err as Error).message);
  }
  return ruleIntent(message);
}
