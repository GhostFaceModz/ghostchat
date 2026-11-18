/** Workspace-level canned replies stored on the workspace owner. */
export type CannedReply = { title: string; text: string };

export function normalizeCannedReplies(input: unknown, limit = 40): CannedReply[] {
  if (!Array.isArray(input)) return [];
  const out: CannedReply[] = [];
  for (const raw of input) {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const title = String(row.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const text = String(row.text || "").trim().slice(0, 1500);
    if (title.length >= 2 && text.length >= 2) out.push({ title, text });
    if (out.length >= limit) break;
  }
  return out;
}
