/** Shared indexing: store chunks with embeddings, refresh counts, and incremental (hash-based) page updates. */
import crypto from "node:crypto";
import { getDb } from "./supabase.js";
import { embedTexts } from "./ai.js";
import { chunkText, type TextChunk } from "./chunk.js";
import { pageChunk, type CrawledPage, type CrawlScope } from "./crawl.js";
import type { Site } from "../types.js";
import { currentEmbeddingModel } from "./embeddingSpace.js";

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

export function normPageUrl(u: string): string {
  try { const x = new URL(u); x.hash = ""; if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, ""); return x.href; } catch { return u; }
}

export async function storeChunks(opts: {
  site: Pick<Site, "id">;
  documentId: string;
  sourceType: string;
  chunks: Array<{ title: string; url: string | null; heading?: string | null; content: string; tokenCount: number }>;
}): Promise<number> {
  if (!opts.chunks.length) return 0;
  const vectors = await embedTexts(opts.chunks.map((c) => c.content));
  const rows = opts.chunks.map((chunk, i) => ({
    site_id: opts.site.id,
    document_id: opts.documentId,
    url: chunk.url,
    title: chunk.title,
    heading: chunk.heading || null,
    content: chunk.content,
    token_count: chunk.tokenCount,
    source_type: opts.sourceType,
    embedding: vectors[i],
    embedding_model: currentEmbeddingModel(),
  }));
  for (let i = 0; i < rows.length; i += 80) {
    const { error } = await getDb().from("ghostchat_chunks").insert(rows.slice(i, i + 80));
    if (error) throw error;
  }
  return rows.length;
}

export async function refreshCounts(siteId: string): Promise<void> {
  const db = getDb();
  const [{ count: chunks }, { count: docs }] = await Promise.all([
    db.from("ghostchat_chunks").select("id", { count: "exact", head: true }).eq("site_id", siteId),
    db.from("ghostchat_documents").select("id", { count: "exact", head: true }).eq("site_id", siteId).in("source_type", ["crawl", "lookup"]),
  ]);
  await db.from("ghostchat_sites").update({ chunk_count: chunks ?? 0, page_count: docs ?? 0, updated_at: new Date().toISOString() }).eq("id", siteId);
}

export function pageChunks(page: CrawledPage, scope?: CrawlScope): TextChunk[] {
  if (scope?.page_chunks) return [pageChunk(page)];
  if (page.sections?.length) {
    return page.sections.flatMap((s) => chunkText(s.text, { title: page.title, url: page.url, heading: s.heading }));
  }
  return chunkText(page.text, { title: page.title, url: page.url });
}

type ExistingDoc = { id: string; source_url: string | null; content_hash: string | null; source_type: string };

/** What an incremental update has to do, given the stored page hashes and the freshly fetched pages. Pure, for tests. */
export function planIncremental(existing: ExistingDoc[], pages: CrawledPage[], opts: { removeMissing: boolean }) {
  const byUrl = new Map<string, ExistingDoc>();
  for (const d of existing) if (d.source_url) byUrl.set(normPageUrl(d.source_url), d);
  const add: CrawledPage[] = [];
  const replace: Array<{ page: CrawledPage; doc: ExistingDoc }> = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const key = normPageUrl(page.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = byUrl.get(key);
    if (!doc) add.push(page);
    else if (doc.content_hash && doc.content_hash === contentHash(page.text)) unchanged.push(doc.id);
    else replace.push({ page, doc });
  }
  const remove = opts.removeMissing
    ? existing.filter((d) => d.source_type === "crawl" && (!d.source_url || !seen.has(normPageUrl(d.source_url)))).map((d) => d.id)
    : [];
  return { add, replace, unchanged, remove };
}

/** Index pages, re-embedding only new or changed ones. Returns counts. */
export async function indexPages(site: Pick<Site, "id">, pages: CrawledPage[], opts: { sourceType: "crawl" | "lookup"; removeMissing: boolean; scope?: CrawlScope }) {
  const db = getDb();
  const { data, error } = await db.from("ghostchat_documents").select("id, source_url, content_hash, source_type").eq("site_id", site.id).in("source_type", ["crawl", "lookup"]);
  if (error) throw error;
  const plan = planIncremental((data ?? []) as ExistingDoc[], pages, { removeMissing: opts.removeMissing });
  let chunks = 0;
  const write = async (page: CrawledPage) => {
    const list = pageChunks(page, opts.scope);
    if (!list.length) return;
    const { data: doc, error: e } = await db.from("ghostchat_documents").insert({
      site_id: site.id, filename: page.title.slice(0, 300), source_type: opts.sourceType, source_url: page.url,
      byte_size: page.text.length, chunk_count: list.length, content_hash: contentHash(page.text),
    }).select("id").single();
    if (e) throw e;
    chunks += await storeChunks({ site, documentId: doc.id, sourceType: opts.sourceType === "lookup" ? "crawl" : opts.sourceType, chunks: list });
  };
  const drop = async (ids: string[]) => {
    if (!ids.length) return;
    await db.from("ghostchat_chunks").delete().in("document_id", ids);
    await db.from("ghostchat_documents").delete().in("id", ids);
  };
  await drop([...plan.remove, ...plan.replace.map((r) => r.doc.id)]);
  for (const page of [...plan.add, ...plan.replace.map((r) => r.page)]) await write(page);
  await refreshCounts(site.id);
  return { added: plan.add.length, updated: plan.replace.length, unchanged: plan.unchanged.length, removed: plan.remove.length, chunks };
}
