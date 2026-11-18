import { getDb } from "./supabase.js";
import { normalizeCannedReplies } from "./cannedReplies.js";
import { supportSettings } from "./modes.js";
import type { Site } from "../types.js";

export type KnowledgeFaq = { id: string; question: string; answer: string; source_url: string | null; created_at: string };
export type KnowledgeTeach = { id: string; question: string; answer: string; created_at: string };
export type KnowledgeCanned = { title: string; text: string; scope: "workspace" | "site" };
export type KnowledgeSource = { id: string; title: string; url: string | null; chunk_count: number; created_at: string };

export type KnowledgeExport = {
  exported_at: string;
  site: { id: string; name: string; url: string };
  faqs: KnowledgeFaq[];
  teach_answers: KnowledgeTeach[];
  canned_replies: KnowledgeCanned[];
  crawled_sources: KnowledgeSource[];
};

function parseFaqText(filename: string | null, text: string): { question: string; answer: string } {
  const body = String(text || "").trim();
  const m = body.match(/^Q:\s*([\s\S]+?)\nA:\s*([\s\S]+)$/i);
  if (m) return { question: m[1].replace(/\s+/g, " ").trim(), answer: m[2].trim() };
  return { question: String(filename || "FAQ").trim() || "FAQ", answer: body };
}

export async function buildKnowledgeExport(site: Site): Promise<KnowledgeExport> {
  const db = getDb();
  const [{ data: docs }, { data: corrections }, { data: owner }] = await Promise.all([
    db.from("ghostchat_documents")
      .select("id, filename, source_type, source_url, chunk_count, created_at")
      .eq("site_id", site.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    db.from("ghostchat_corrections")
      .select("id, question, answer, created_at")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false }),
    db.from("ghostchat_owners").select("canned_replies").eq("id", site.owner_id).maybeSingle(),
  ]);

  const allDocs = (docs ?? []) as Array<{
    id: string; filename: string | null; source_type: string | null; source_url: string | null; chunk_count: number | null; created_at: string;
  }>;
  const faqDocs = allDocs.filter((d) => d.source_type === "faq").slice(0, 2000);
  const crawled_sources: KnowledgeSource[] = allDocs
    .filter((d) => d.source_type === "crawl")
    .slice(0, 5000)
    .map((d) => ({
      id: d.id,
      title: d.filename || d.source_url || "Page",
      url: d.source_url || null,
      chunk_count: Number(d.chunk_count || 0),
      created_at: d.created_at,
    }));

  const faqIds = faqDocs.map((d) => d.id);
  let chunksByDoc = new Map<string, string[]>();
  if (faqIds.length) {
    const { data: chunks } = await db
      .from("ghostchat_chunks")
      .select("document_id, content")
      .eq("site_id", site.id)
      .in("document_id", faqIds);
    for (const row of (chunks ?? []) as Array<{ document_id: string; content: string }>) {
      const list = chunksByDoc.get(row.document_id) || [];
      list.push(String(row.content || ""));
      chunksByDoc.set(row.document_id, list);
    }
  }

  const faqs: KnowledgeFaq[] = faqDocs.map((d) => {
    const parsed = parseFaqText(d.filename, (chunksByDoc.get(d.id) || []).join("\n\n"));
    return { id: d.id, question: parsed.question, answer: parsed.answer, source_url: d.source_url || null, created_at: d.created_at };
  });

  const teach_answers: KnowledgeTeach[] = ((corrections ?? []) as KnowledgeTeach[]).slice(0, 5000).map((c) => ({
    id: c.id,
    question: String(c.question || "").trim(),
    answer: String(c.answer || "").trim(),
    created_at: c.created_at,
  }));

  const workspace = normalizeCannedReplies(owner?.canned_replies).map((c) => ({ ...c, scope: "workspace" as const }));
  const siteCanned = supportSettings(site).canned.map((c) => ({ title: c.title, text: c.text, scope: "site" as const }));
  const seen = new Set<string>();
  const canned_replies: KnowledgeCanned[] = [];
  for (const row of [...workspace, ...siteCanned]) {
    const key = row.title.toLowerCase() + "\n" + row.text;
    if (seen.has(key)) continue;
    seen.add(key);
    canned_replies.push(row);
    if (canned_replies.length >= 200) break;
  }

  return {
    exported_at: new Date().toISOString(),
    site: { id: site.id, name: site.name, url: site.url },
    faqs,
    teach_answers,
    canned_replies,
    crawled_sources,
  };
}

export function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function knowledgeExportToCsv(data: KnowledgeExport): string {
  const header = ["type", "title", "body", "url", "created_at", "scope"];
  const rows: string[][] = [header];
  for (const f of data.faqs) rows.push(["faq", f.question, f.answer, f.source_url || "", f.created_at, ""]);
  for (const t of data.teach_answers) rows.push(["teach", t.question, t.answer, "", t.created_at, ""]);
  for (const c of data.canned_replies) rows.push(["canned", c.title, c.text, "", "", c.scope]);
  for (const s of data.crawled_sources) rows.push(["crawl", s.title, "", s.url || "", s.created_at, ""]);
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

export function exportFilename(site: Pick<Site, "name">, format: "json" | "csv"): string {
  const slug = String(site.name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
  const day = new Date().toISOString().slice(0, 10);
  return `ghostchat-knowledge-${slug}-${day}.${format}`;
}
