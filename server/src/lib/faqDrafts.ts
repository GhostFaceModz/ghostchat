/** Auto-generate FAQ drafts from crawled pages and schema.org FAQPage blocks, for owner approval. */
import { getDb } from "./supabase.js";
import { chunkText } from "./chunk.js";
import { storeChunks, refreshCounts } from "./indexer.js";
import type { CrawledPage } from "./crawl.js";
import type { Site } from "../types.js";

export type FaqDraft = {
  id: string;
  site_id: string;
  question: string;
  answer: string;
  source_url: string | null;
  status: "pending" | "approved" | "rejected";
};

export type FaqCandidate = { question: string; answer: string; source_url?: string | null };

const Q_LINE = /^(?:q(?:uestion)?\s*[:.\)-]\s*)(.+\??)\s*$/i;

export function faqCandidatesFromPages(pages: CrawledPage[]): FaqCandidate[] {
  const out: FaqCandidate[] = [];
  const seen = new Set<string>();
  const add = (q: string, a: string, url?: string | null) => {
    const question = q.replace(/\s+/g, " ").trim();
    const answer = a.replace(/\s+/g, " ").trim();
    if (question.length < 8 || answer.length < 20) return;
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ question, answer: answer.slice(0, 2000), source_url: url || null });
  };
  for (const page of pages) {
    const lines = page.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const qm = line.match(Q_LINE) || (/^[A-Z].{8,120}\?$/.test(line) ? [line, line] : null);
      if (!qm) continue;
      const next = lines[i + 1] || "";
      if (/^a(?:nswer)?\s*[:.\)-]\s*/i.test(next)) add(qm[1], next.replace(/^a(?:nswer)?\s*[:.\)-]\s*/i, ""), page.url);
      else if (next.length >= 20 && !next.endsWith("?")) add(qm[1], next, page.url);
    }
  }
  return out.slice(0, 40);
}

export async function saveFaqDrafts(siteId: string, candidates: FaqCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const db = getDb();
  const { data: existing } = await db.from("ghostchat_faq_drafts").select("question, status").eq("site_id", siteId);
  const skip = new Set((existing || []).map((r: { question: string }) => r.question.trim().toLowerCase()));
  let n = 0;
  for (const c of candidates) {
    if (skip.has(c.question.trim().toLowerCase())) continue;
    const { error } = await db.from("ghostchat_faq_drafts").insert({
      site_id: siteId,
      question: c.question,
      answer: c.answer,
      source_url: c.source_url || null,
      status: "pending",
    });
    if (!error) n++;
    skip.add(c.question.trim().toLowerCase());
  }
  return n;
}

export async function listFaqDrafts(siteId: string, status?: string): Promise<FaqDraft[]> {
  let q = getDb().from("ghostchat_faq_drafts").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(80);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FaqDraft[];
}

export async function setFaqDraftStatus(site: Pick<Site, "id">, draftId: string, status: "approved" | "rejected"): Promise<FaqDraft | null> {
  const db = getDb();
  const { data: draft, error } = await db.from("ghostchat_faq_drafts").select("*").eq("id", draftId).eq("site_id", site.id).maybeSingle();
  if (error) throw error;
  if (!draft) return null;
  if (status === "approved") {
    const title = draft.question.slice(0, 200);
    const text = `Q: ${draft.question}\nA: ${draft.answer}`;
    const chunks = chunkText(text, { title, url: draft.source_url, heading: draft.question });
    const { data: doc, error: de } = await db.from("ghostchat_documents").insert({
      site_id: site.id,
      filename: title,
      source_type: "faq",
      source_url: draft.source_url,
      byte_size: text.length,
      chunk_count: chunks.length,
    }).select("id").single();
    if (de) throw de;
    await storeChunks({ site, documentId: doc.id, sourceType: "faq", chunks });
    await refreshCounts(site.id);
  }
  const { data: updated, error: ue } = await db.from("ghostchat_faq_drafts").update({ status, updated_at: new Date().toISOString() }).eq("id", draftId).eq("site_id", site.id).select("*").single();
  if (ue) throw ue;
  return updated as FaqDraft;
}
