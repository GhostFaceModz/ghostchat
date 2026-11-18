/** Knowledge coverage: trained page URLs vs pages visitors ask from and sources the bot cites. */
import { getDb } from "./supabase.js";
import { normPageUrl } from "./indexer.js";

export type CoverageDoc = { source_url: string | null; filename?: string | null; source_type?: string };
export type CoverageLog = { role: string; page_url?: string | null; sources?: Array<{ url?: string | null }> | null };

export function buildCoverageMap(docs: CoverageDoc[], logs: CoverageLog[]) {
  const trained = new Map<string, { url: string; title: string; cited: number }>();
  for (const d of docs) {
    if (!d.source_url) continue;
    const key = normPageUrl(d.source_url);
    if (!key || !trained.has(key)) trained.set(key, { url: d.source_url, title: d.filename || d.source_url, cited: 0 });
  }
  const gaps = new Map<string, { url: string; questions: number }>();
  for (const log of logs) {
    if (log.role === "assistant") {
      for (const s of log.sources || []) {
        if (!s?.url) continue;
        const row = trained.get(normPageUrl(s.url));
        if (row) row.cited++;
      }
    }
    if (log.role === "user" && log.page_url) {
      const key = normPageUrl(log.page_url);
      if (!key || trained.has(key)) continue;
      const row = gaps.get(key) || { url: log.page_url, questions: 0 };
      row.questions++;
      gaps.set(key, row);
    }
  }
  const unused = [...trained.values()].filter((t) => t.cited === 0).slice(0, 25);
  const uncovered = [...gaps.values()].sort((a, b) => b.questions - a.questions).slice(0, 25);
  const trainedCount = trained.size;
  const citedCount = [...trained.values()].filter((t) => t.cited > 0).length;
  return {
    trained: trainedCount,
    cited: citedCount,
    coverage: trainedCount ? Math.round((citedCount / trainedCount) * 100) : null,
    unused,
    gaps: uncovered,
  };
}

export async function siteCoverage(siteId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const db = getDb();
  const [{ data: docs, error: docErr }, { data: logs, error: logErr }] = await Promise.all([
    db.from("ghostchat_documents").select("source_url, filename, source_type").eq("site_id", siteId),
    db.from("ghostchat_logs").select("role, page_url, sources").eq("site_id", siteId).gte("created_at", since).limit(4000),
  ]);
  if (docErr) throw docErr;
  if (logErr) throw logErr;
  return buildCoverageMap((docs ?? []) as CoverageDoc[], (logs ?? []) as CoverageLog[]);
}
