/** Rerank retrieved chunks so product/overview pages beat legal boilerplate. */

import type { RetrievedChunk } from "../types.js";

export function urlPath(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return (u.pathname.replace(/\/+$/, "") || "/") + (u.hash || "");
  } catch {
    const raw = String(url).split("?")[0];
    const path = raw.replace(/^https?:\/\/[^/]+/i, "");
    return path.replace(/\/+$/, "") || "/";
  }
}

const LEGAL_PATH = /(^|\/)(privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|legal|cookies?|cookie-policy|gdpr|tos|imprint|impressum)(\/|$)/i;

export function isLegalUrl(url: string | null | undefined): boolean {
  return LEGAL_PATH.test(urlPath(url).replace(/#.*$/, ""));
}

export function isHomeUrl(url: string | null | undefined): boolean {
  const path = urlPath(url).replace(/#.*$/, "").toLowerCase() || "/";
  return path === "/" || /^(about|about-us|aboutus|home|features|overview|product)\/?$/.test(path.replace(/^\//, ""));
}

export function isPricingUrl(url: string | null | undefined): boolean {
  const path = urlPath(url).toLowerCase();
  return /(^|\/|#)(pricing|plans|price|billing)(\/|$|#)/.test(path);
}

export function isLegalQuestion(question: string): boolean {
  return /\b(privacy(\s+policy)?|terms(\s+of\s+service)?|cookie|cookies|gdpr|legal (notice|policy|terms)|imprint|data protection|\btos\b)\b/i.test(question);
}

/** True only when the visitor is asking what the site/product is. Greetings, "help", and lookups are not overview questions. */
export function isBroadQuestion(question: string): boolean {
  const q = question.trim();
  if (/\b(what can (you|it|this|they|[a-z0-9][\w '.-]{0,40}) do|what does .{0,40}\bdo\b|what (is|are) (you|this|it|ghostchat|[a-z0-9][\w '.-]{0,40})|tell me about|who are you|how does (it|this|your|the) work|what('?s| is) this (site|page|product|app|bot)|capabilit(y|ies)|what do you (do|offer)|about (the )?(site|app|product|you))\b/i.test(q)) {
    return true;
  }
  // Don't treat "how much" / "how do I" / greetings / "help" as an overview.
  const words = q.split(/\s+/).filter(Boolean);
  return words.length <= 6 && /^(what|what'?s|who|tell|explain|features|about)\b/i.test(q) && !/\b(price|cost|much)\b/i.test(q);
}

export function isPricingQuestion(question: string): boolean {
  return /\b(price|prices|pricing|cost|costs|how much|plan|plans|subscription|billing|monthly|yearly|per month|per year|\bvat\b|cheap|expensive|fee|fees|upgrade)\b/i.test(question);
}

export function isSetupQuestion(question: string): boolean {
  return /\b(install|embed|widget|snippet|set ?up|add (it|the widget|the bot|the chat|the assistant)|script tag|wordpress|shopify|wix|webflow|squarespace|how do i (add|get started|start|install)|paste .{0,20}code)\b/i.test(question);
}

export function hasPriceSignal(chunk: Pick<RetrievedChunk, "content" | "title" | "heading" | "url">): boolean {
  const text = `${chunk.title || ""} ${chunk.heading || ""} ${chunk.content || ""} ${chunk.url || ""}`;
  return /£|\$\d|€|\/\s*month|per month|\/\s*year|per year|\bvat\b|free plan|pro plan|business plan|billed (monthly|yearly)/i.test(text);
}

export function hasSetupSignal(chunk: Pick<RetrievedChunk, "content" | "title" | "heading" | "url">): boolean {
  const text = `${chunk.title || ""} ${chunk.heading || ""} ${chunk.content || ""} ${chunk.url || ""}`;
  return /widget\.js|data-id=|script src|paste one line|custom code|shopify|wordpress|webflow|squarespace|\bwix\b|setup guide/i.test(text);
}

export function isOverviewChunk(chunk: Pick<RetrievedChunk, "url" | "title" | "heading" | "content">): boolean {
  if (isHomeUrl(chunk.url) && !isLegalUrl(chunk.url)) return true;
  const head = `${chunk.title || ""} ${chunk.heading || ""}`;
  return /\b(what you can build|what (we|it|ghostchat) (is|does|can)|features|overview|about (us|ghostchat)|your site\.?\s*your answers)\b/i.test(head);
}

export function adjustedScore(question: string, chunk: RetrievedChunk, legalQuestion = isLegalQuestion(question)): number {
  let score = Number(chunk.similarity) || 0;
  if (isLegalUrl(chunk.url) && !legalQuestion) score -= 0.35;
  const broad = isBroadQuestion(question);
  if (broad && (isHomeUrl(chunk.url) || isOverviewChunk(chunk))) score += 0.22;
  if (isPricingQuestion(question) && (hasPriceSignal(chunk) || isPricingUrl(chunk.url))) score += 0.25;
  if (isSetupQuestion(question) && hasSetupSignal(chunk)) score += 0.2;
  if (/\b(q:\s|faq|questions?, answered)\b/i.test(`${chunk.heading || ""} ${chunk.content || ""}`.slice(0, 200))) score += 0.08;
  return score;
}

function dedupe(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const c of chunks) {
    const key = c.id || `${c.url || ""}::${(c.content || "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Reorder and trim a candidate pool. Homepage/about chunks are injected only for real overview questions. */
export function rerankChunks(
  question: string,
  chunks: RetrievedChunk[],
  opts: { overview?: RetrievedChunk[]; keep?: number } = {},
): RetrievedChunk[] {
  const keep = Math.min(8, Math.max(1, Math.round(Number(opts.keep) || 6)));
  const legalQ = isLegalQuestion(question);
  const broad = isBroadQuestion(question);
  const overview = broad ? (opts.overview || []).filter((c) => c && (c.content || "").trim()) : [];
  const pool = dedupe([
    ...chunks,
    ...overview.map((c) => ({ ...c, similarity: Number(c.similarity) > 0 ? c.similarity : 0.55 })),
  ]);
  const ranked = pool
    .map((c) => ({ c, score: adjustedScore(question, c, legalQ) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.c);

  const picked: RetrievedChunk[] = [];
  for (const c of ranked) {
    if (picked.length >= keep) break;
    picked.push(c);
  }

  if (!legalQ && broad) {
    const want = 2;
    const overviewPool = dedupe([
      ...overview,
      ...pool.filter((c) => isHomeUrl(c.url) || isOverviewChunk(c)),
    ]).filter((c) => !isLegalUrl(c.url));
    let inserted = 0;
    for (const o of overviewPool) {
      if (inserted >= want) break;
      if (picked.some((p) => p.id === o.id || p.content === o.content)) {
        inserted++;
        continue;
      }
      const evictIdx = picked.map((_, i) => i).reverse().find((i) => isLegalUrl(picked[i].url) || !(isHomeUrl(picked[i].url) || isOverviewChunk(picked[i])));
      if (picked.length >= keep && evictIdx != null) picked.splice(evictIdx, 1);
      const insertAt = Math.min(1, picked.length);
      picked.splice(insertAt, 0, o);
      inserted++;
      if (picked.length > keep) {
        const tail = picked.length - 1;
        const drop = isLegalUrl(picked[tail].url) ? tail : picked.findIndex((p, i) => i > insertAt && isLegalUrl(p.url));
        picked.splice(drop >= 0 ? drop : tail, 1);
      }
    }
  }
  return picked.slice(0, keep);
}
