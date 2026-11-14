/** Smarter memory: remember returning visitors' preferences (anonymous id, opt-out respected, no PII). */
import { getDb } from "./supabase.js";
import { redactPii } from "./pii.js";
import { keywords } from "./liveLookup.js";
import type { Site } from "../types.js";

export type VisitorPrefs = { likes?: string[]; topics?: string[]; lang?: string };
export type Visitor = { visitor_id: string; visits: number; last_session_id: string | null; prefs: VisitorPrefs; last_seen: string; first_seen?: string };

export const VISITOR_ID_RE = /^v_[a-z0-9]{8,40}$/;

const LIKE_RE = /\b(?:i (?:really |do |also )?(?:like|love|enjoy|prefer|adore)|i'?m (?:really )?(?:into|a fan of|looking for)|my fav(?:ou?rite)? (?:\w+ )?(?:is|are))\s+([^.,!?;\n]{3,60})/gi;

/** Pull simple stated preferences ("I love horror films") out of a message. */
export function extractPrefs(message: string): VisitorPrefs {
  const likes: string[] = [];
  for (const m of String(message || "").matchAll(LIKE_RE)) {
    const v = redactPii(m[1].trim().replace(/\s+/g, " ")).toLowerCase();
    if (v && !/\[redacted|@|\d{5,}/i.test(v) && !likes.includes(v)) likes.push(v);
  }
  return { likes, topics: keywords(message, 3) };
}

export function mergePrefs(old: VisitorPrefs, add: VisitorPrefs): VisitorPrefs {
  const merge = (a: string[] = [], b: string[] = [], max: number) => [...new Set([...b, ...a])].slice(0, max);
  return { likes: merge(old.likes, add.likes, 8), topics: merge(old.topics, add.topics, 8), lang: add.lang || old.lang };
}

export function memoryPrompt(v: Visitor | null, now = Date.now()): string {
  if (!v || v.visits < 2) return "";
  const days = Math.max(0, Math.round((now - new Date(v.last_seen).getTime()) / 86400000));
  const likes = v.prefs.likes?.length ? `They told you they like: ${v.prefs.likes.slice(0, 5).join("; ")}.` : "";
  const topics = v.prefs.topics?.length ? `Last time they asked about: ${v.prefs.topics.slice(0, 5).join(", ")}.` : "";
  if (!likes && !topics) return "";
  return `
RETURNING VISITOR (visit ${v.visits}, last here ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}). ${likes} ${topics}
- Use this only when it genuinely helps (e.g. tailoring a recommendation), mention it lightly at most once, and never invent details. If asked, explain the chat remembers preferences on this device and they can turn that off in the chat menu.`;
}

export function memoryOn(site: Pick<Site, "memory_enabled">): boolean {
  return site.memory_enabled !== false;
}

export async function loadVisitor(siteId: string, visitorId: string): Promise<Visitor | null> {
  if (!VISITOR_ID_RE.test(visitorId)) return null;
  const { data } = await getDb().from("ghostchat_visitors").select("visitor_id, visits, last_session_id, prefs, last_seen, first_seen").eq("site_id", siteId).eq("visitor_id", visitorId).maybeSingle();
  return (data as Visitor) ?? null;
}

/** Record this message: counts a new visit per new session and merges any stated preferences. */
export async function rememberVisitor(siteId: string, visitorId: string, sessionId: string, message: string, lang: string, existing: Visitor | null): Promise<void> {
  if (!VISITOR_ID_RE.test(visitorId)) return;
  const prefs = mergePrefs(existing?.prefs || {}, { ...extractPrefs(message), lang });
  const now = new Date().toISOString();
  if (!existing) {
    await getDb().from("ghostchat_visitors").upsert({ site_id: siteId, visitor_id: visitorId, visits: 1, last_session_id: sessionId, prefs, last_seen: now }, { onConflict: "site_id,visitor_id" });
    return;
  }
  const visits = existing.last_session_id === sessionId ? existing.visits : existing.visits + 1;
  await getDb().from("ghostchat_visitors").update({ visits, last_session_id: sessionId, prefs, last_seen: now }).eq("site_id", siteId).eq("visitor_id", visitorId);
}

export async function forgetVisitor(siteId: string, visitorId: string): Promise<void> {
  if (!VISITOR_ID_RE.test(visitorId)) return;
  await getDb().from("ghostchat_visitors").delete().eq("site_id", siteId).eq("visitor_id", visitorId);
}
