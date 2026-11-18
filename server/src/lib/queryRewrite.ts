/** Turn a short follow-up into a standalone search query using recent chat history. */
export type HistoryTurn = { role: string; content: string };

const FOLLOW_UP = /^(and |but |what about|how about|what if|and what|also |is that|does it|do they|can i|can you|how much|how long|is there|are there|which one|the \w+ (plan|one|option)|it\b|that\b|this\b|they\b|them\b)/i;

export function looksLikeFollowUp(question: string): boolean {
  const q = question.trim();
  if (q.length < 80 && (FOLLOW_UP.test(q) || q.split(/\s+/).length <= 5)) return true;
  return /\b(it|that|this|they|them|those|one|too)\b/i.test(q) && q.length < 120;
}

/** Pure. Returns the original question when history doesn't help. */
export function rewriteQuery(question: string, history: HistoryTurn[] = []): string {
  const q = question.trim();
  if (!q) return q;
  const prior = [...history].reverse().find((t) => t.role === "user" && t.content.trim() && t.content.trim() !== q);
  if (!prior) return q;
  if (!looksLikeFollowUp(q)) return q;
  const prev = prior.content.trim().replace(/\s+/g, " ").slice(0, 240);
  if (q.toLowerCase().includes(prev.toLowerCase().slice(0, 40))) return q;
  return `${prev} — ${q}`.slice(0, 500);
}
