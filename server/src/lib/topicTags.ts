import { keywords } from "./liveLookup.js";

/** Common support intents, matched against keyword tokens. Unknown wording still falls back to raw keywords. */
export const TOPIC_BUCKETS: Array<{ tag: string; words: string[] }> = [
  { tag: "shipping", words: ["shipping", "delivery", "postage", "courier", "dispatch", "tracking", "shipment"] },
  { tag: "returns", words: ["return", "returns", "refund", "refunds", "exchange"] },
  { tag: "pricing", words: ["price", "prices", "pricing", "cost", "costs", "plan", "plans", "subscription", "billing", "fee", "fees"] },
  { tag: "account", words: ["account", "login", "password", "signin", "signup"] },
  { tag: "hours", words: ["hours", "opening", "closed", "holiday"] },
  { tag: "booking", words: ["book", "booking", "appointment", "schedule", "reservation"] },
  { tag: "support", words: ["support", "issue", "problem", "bug", "error", "broken"] },
  { tag: "product", words: ["product", "products", "item", "catalogue", "catalog"] },
];

function tokenHits(kws: string[], words: string[]): boolean {
  return kws.some((k) => words.some((w) => k === w || (k.length >= 4 && w.startsWith(k)) || (w.length >= 4 && k.startsWith(w))));
}

export function topicTagsFromText(text: string, max = 3): string[] {
  const kws = keywords(String(text || ""), 8);
  if (!kws.length) return [];
  const tags: string[] = [];
  for (const bucket of TOPIC_BUCKETS) {
    if (tags.length >= max) break;
    if (tokenHits(kws, bucket.words)) {
      if (!tags.includes(bucket.tag)) tags.push(bucket.tag);
    }
  }
  if (!tags.length) {
    for (const k of kws) {
      if (tags.length >= max) break;
      if (!tags.includes(k)) tags.push(k);
    }
  }
  return tags.slice(0, max);
}

export function resolveTopicTags(message: string, stored?: string[] | null): string[] {
  const existing = (stored || []).map((t) => String(t || "").toLowerCase().trim()).filter(Boolean);
  if (existing.length) return [...new Set(existing)].slice(0, 3);
  return topicTagsFromText(message);
}

export function topicBreakdown(rows: Array<{ session_id: string; role: string; message: string; topic_tags?: string[] | null }>, limit = 12) {
  const byTag = new Map<string, { messages: number; sessions: Set<string> }>();
  for (const row of rows) {
    if (row.role !== "user") continue;
    const tags = resolveTopicTags(row.message, row.topic_tags);
    for (const tag of tags) {
      const cur = byTag.get(tag) || { messages: 0, sessions: new Set<string>() };
      cur.messages += 1;
      cur.sessions.add(row.session_id);
      byTag.set(tag, cur);
    }
  }
  return [...byTag.entries()]
    .map(([tag, v]) => ({ tag, messages: v.messages, conversations: v.sessions.size }))
    .sort((a, b) => b.conversations - a.conversations || b.messages - a.messages || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
