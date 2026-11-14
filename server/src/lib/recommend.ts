import { completeChat } from "./ai.js";
import { classifyIntent, parseJsonObject, type Intent } from "./intent.js";
import { pickTool, runTool, toolsFor, type SearchTool, type ToolItem } from "./siteTools.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";

/** A card in the widget carousel. Every field comes from the site tool's result, except the one-line "why". */
export type ResultCard = ToolItem & { why: string | null; cta: string };
export type ToolTurn = { answer: string; results: ResultCard[]; suggestions: string[]; intent: Intent; tool: string | null };

async function recentHistory(siteId: string, sessionId: string, message: string) {
  try {
    const { data } = await getDb()
      .from("ghostchat_logs")
      .select("role, message")
      .eq("site_id", siteId)
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as Array<{ role: "user" | "assistant"; message: string }>;
    if (rows[0]?.role === "user" && rows[0].message.trim() === message) rows.shift();
    return rows.reverse().map((r) => ({ role: r.role, content: r.message }));
  } catch {
    return [];
  }
}

/** A reply cut off mid-JSON still carries usable picks: pull out what is complete. */
export function salvage(raw: string): { intro: string; picks: Array<{ n: number; why: string }> } | null {
  const intro = raw.match(/"intro"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
  const picks = [...raw.matchAll(/"n"\s*:\s*(\d+)\s*,\s*"why"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ n: Number(m[1]), why: m[2].replace(/\\"/g, '"') }));
  return intro || picks.length ? { intro: intro.replace(/\\"/g, '"'), picks } : null;
}

/**
 * The model only picks from the numbered results (by number) and writes a short reason for each.
 * Titles, links and images are copied from the tool results, so nothing can be invented.
 */
export async function composePicks(site: Site, message: string, items: ToolItem[], tool: Pick<SearchTool, "button_label">, ask = completeChat): Promise<{ intro: string; cards: ResultCard[] }> {
  items = items.slice(0, 12);
  const list = items.map((it, i) => `${i + 1}. ${it.title}${it.year ? ` (${it.year})` : ""}${it.rating ? ` ★${it.rating}` : ""}${it.subtitle ? ` — ${it.subtitle}` : ""}${it.description ? `: ${it.description.slice(0, 140)}` : ""}`).join("\n");
  let intro = "";
  let picks: Array<{ n: number; why: string }> = [];
  try {
    const raw = await ask(
      [
        {
          role: "system",
          content: `You are the assistant on "${site.name}". Pick the best matches for the visitor from the numbered RESULTS (found on ${site.name}).
Reply with ONE JSON object only: {"intro": string, "picks": [{"n": number, "why": string}]}
- intro: one short friendly sentence (under 140 characters). Do not name any title that is not in RESULTS. No lists, no links.
- picks: 3 to 6 result numbers (fewer only if fewer fit), best first. why: max 12 words, why it fits this request. Only use numbers from RESULTS.`,
        },
        { role: "user", content: `Visitor: ${message.slice(0, 500)}\n\nRESULTS:\n${list}` },
      ],
      { maxTokens: 700, temperature: 0.4, json: true, fast: true, site },
    );
    if (process.env.GC_DEBUG_TOOLS) console.log("picks raw", raw.slice(0, 400));
    const o = (parseJsonObject(raw) || salvage(raw)) as { intro?: unknown; picks?: unknown } | null;
    if (o) {
      intro = typeof o.intro === "string" ? o.intro.trim().slice(0, 200) : "";
      if (Array.isArray(o.picks)) picks = o.picks.map((p) => ({ n: Number((p as { n?: unknown }).n), why: String((p as { why?: unknown }).why ?? "").trim().slice(0, 110) }));
    }
  } catch (err) {
    console.warn("picks fallback:", (err as Error).message);
  }
  if (picks.some((p) => p.n === 0)) picks = picks.map((p) => ({ ...p, n: p.n + 1 })); // zero-based reply
  const seen = new Set<number>();
  const chosen = picks.filter((p) => Number.isInteger(p.n) && p.n >= 1 && p.n <= items.length && !seen.has(p.n) && (seen.add(p.n), true)).slice(0, 6);
  const cards: ResultCard[] = (chosen.length ? chosen : items.slice(0, 6).map((_, i) => ({ n: i + 1, why: "" })))
    .map((p) => ({ ...items[p.n - 1], why: p.why || items[p.n - 1].subtitle || null, cta: tool.button_label }));
  // An intro that names a title we don't have would be an invented recommendation: replace it.
  const quoted = [...intro.matchAll(/["“”*_]+([^"“”*_]{2,60})["“”*_]+/g)].map((m) => m[1].toLowerCase());
  if (!intro || quoted.some((q) => !items.some((it) => it.title.toLowerCase() === q) && !message.toLowerCase().includes(q))) intro = `Here are some picks from ${site.name}:`;
  return { intro, cards };
}

/** Run the site's search tool when the visitor's intent fits. Returns null to fall back to the normal answer. */
export async function toolTurn(site: Site, sessionId: string, message: string, deps: { classify?: typeof classifyIntent; fetcher?: typeof fetch; ask?: typeof completeChat } = {}): Promise<ToolTurn | null> {
  const tools = toolsFor(site);
  if (!tools.length) return null;
  const history = await recentHistory(site.id, sessionId, message);
  const intent = await (deps.classify || classifyIntent)(message, history);
  if (process.env.GC_DEBUG_TOOLS) console.log("tool intent", JSON.stringify(intent));
  if (intent.intent === "recommend" && intent.clarify) {
    return { answer: intent.clarify, results: [], suggestions: intent.options, intent, tool: null };
  }
  const tool = pickTool(tools, intent.intent);
  if (!tool) return null;
  let items: ToolItem[] = [];
  try {
    items = await runTool(tool, intent.filters, deps.fetcher);
  } catch (err) {
    console.warn(`site tool ${tool.name} failed:`, (err as Error).message);
    return null;
  }
  if (!items.length) return null;
  const { intro, cards } = await composePicks(site, message, items, tool, deps.ask);
  return { answer: intro, results: cards, suggestions: [], intent, tool: tool.name };
}

/** What gets stored in the conversation log (so the owner sees which titles were shown). */
export const logText = (answer: string, results: ResultCard[]) =>
  results.length ? `${answer}\n\n${results.map((r) => `- [${r.title}${r.year ? ` (${r.year})` : ""}](${r.url})`).join("\n")}` : answer;
