/** Turn a short follow-up into a standalone search query using recent chat history. */
export type HistoryTurn = { role: string; content: string };

const FOLLOW_UP = /^(and |but |what about|how about|what if|and what|also |is that|does it|do they|can i|can you|how much|how long|is there|are there|which one|the \w+ (plan|one|option)|it\b|that\b|this\b|they\b|them\b)/i;

export function looksLikeFollowUp(question: string): boolean {
  const q = question.trim();
  if (q.length < 80 && (FOLLOW_UP.test(q) || q.split(/\s+/).length <= 5)) return true;
  return /\b(it|that|this|they|them|those|one)\b/i.test(q) && q.length < 120;
}

/** Common visitor typos, fixed before intent rules and lexical search. */
const TYPO_RULES: Array<[RegExp, string]> = [
  [/\bliat\b/gi, "list"],
  [/\bmoives\b/gi, "movies"],
  [/\bmovis\b/gi, "movies"],
  [/\bmoive\b/gi, "movie"],
  [/\brecommand\b/gi, "recommend"],
  [/\breccomend\b/gi, "recommend"],
  [/\brecomend\b/gi, "recommend"],
  [/\bsimiliar\b/gi, "similar"],
  [/\bsimliar\b/gi, "similar"],
  [/\bsimlar\b/gi, "similar"],
  [/\bshwos\b/gi, "shows"],
  [/\bshws\b/gi, "shows"],
  [/\btoo\s+watch\b/gi, "to watch"],
];

export function fixTypos(text: string): string {
  let out = text;
  for (const [re, rep] of TYPO_RULES) out = out.replace(re, rep);
  return out;
}

/**
 * Light synonym expansion for retrieval. The original words stay; a few related
 * terms are appended so lexical search still hits install, playback, and pricing pages.
 */
export function expandSearchQuery(text: string): string {
  const q = fixTypos(text).replace(/\s+/g, " ").trim();
  if (!q) return q;
  const extra: string[] = [];
  if (/\b(apk|mobile app|phone app|android app|ios app)\b/i.test(q)) extra.push("app install download");
  else if (/\b(install|download)\b/i.test(q)) extra.push("app setup");
  if (/\b(lag|fps|stutter|laggy)\b/i.test(q) || /\bslow\b/i.test(q)) extra.push("performance speed");
  if (/\b(won'?t play|wont play|black screen|buffering|no source|source (?:missing|broken|down))\b/i.test(q)) extra.push("playback video source");
  if (/\b(free|price|prices|pricing|cost|costs|how much)\b/i.test(q)) extra.push("pricing plans");
  if (!extra.length) return q.slice(0, 500);
  return `${q} ${extra.join(" ")}`.replace(/\s+/g, " ").slice(0, 500);
}

/** Pure. Returns the original question when history doesn't help. */
export function rewriteQuery(question: string, history: HistoryTurn[] = []): string {
  const q = fixTypos(question).trim();
  if (!q) return q;
  const prior = [...history].reverse().find((t) => t.role === "user" && t.content.trim() && t.content.trim() !== q);
  if (!prior) return q;
  if (!looksLikeFollowUp(q)) return q;
  const prev = prior.content.trim().replace(/\s+/g, " ").slice(0, 240);
  if (q.toLowerCase().includes(prev.toLowerCase().slice(0, 40))) return q;
  return `${prev} — ${q}`.slice(0, 500);
}
