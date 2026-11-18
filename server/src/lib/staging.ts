/** Staging/test widget: unpublished training plus a separate site key. */
import { randomBytes } from "node:crypto";
import { getDb } from "./supabase.js";
import { embedTexts } from "./ai.js";
import { currentEmbeddingModel } from "./embeddingSpace.js";
import { refreshCounts } from "./indexer.js";
import { normPageUrl } from "./indexer.js";
import type { RetrievedChunk, Site } from "../types.js";

const KEY_RE = /^gc_[A-Za-z0-9_-]+$/;

export function newStagingKey(): string {
  return `gc_stg_${randomBytes(18).toString("base64url")}`;
}

export function isStagingKey(key: string): boolean {
  return key.startsWith("gc_stg_");
}

/** Resolve a public or test-widget key. Staging keys mark the site with site.staging. */
export async function loadSiteByPublicKey(siteKey: string): Promise<Site | null> {
  const key = String(siteKey || "").trim();
  if (!KEY_RE.test(key)) return null;
  const db = getDb();
  const live = await db.from("ghostchat_sites").select("*").eq("site_key", key).maybeSingle();
  if (live.error) throw live.error;
  if (live.data) return live.data as Site;
  const stg = await db.from("ghostchat_sites").select("*").eq("staging_site_key", key).maybeSingle();
  if (stg.error) throw stg.error;
  if (!stg.data) return null;
  return { ...(stg.data as Site), staging: true };
}

export async function ensureStagingKey(site: Site): Promise<string> {
  if (site.staging_site_key) return site.staging_site_key;
  const key = newStagingKey();
  await getDb().from("ghostchat_sites").update({ staging_site_key: key, updated_at: new Date().toISOString() }).eq("id", site.id).is("staging_site_key", null);
  const { data, error } = await getDb().from("ghostchat_sites").select("staging_site_key").eq("id", site.id).single();
  if (error) throw error;
  site.staging_site_key = (data as { staging_site_key: string }).staging_site_key;
  return site.staging_site_key;
}

export async function storeStagingChunks(opts: {
  site: Pick<Site, "id">;
  documentId: string;
  sourceType: string;
  previewId?: string | null;
  chunks: Array<{ title: string; url: string | null; heading?: string | null; content: string; tokenCount: number }>;
}): Promise<number> {
  if (!opts.chunks.length) return 0;
  const vectors = await embedTexts(opts.chunks.map((c) => c.content));
  const rows = opts.chunks.map((chunk, i) => ({
    site_id: opts.site.id,
    document_id: opts.documentId,
    preview_id: opts.previewId || null,
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
    const { error } = await getDb().from("ghostchat_staging_chunks").insert(rows.slice(i, i + 80));
    if (error) throw error;
  }
  return rows.length;
}

export async function refreshStagingCount(siteId: string): Promise<number> {
  const { count } = await getDb().from("ghostchat_staging_chunks").select("id", { count: "exact", head: true }).eq("site_id", siteId);
  const n = count ?? 0;
  await getDb().from("ghostchat_sites").update({ staging_chunk_count: n, updated_at: new Date().toISOString() }).eq("id", siteId);
  return n;
}

export async function listStagingDocuments(siteId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_staging_documents")
    .select("id, filename, source_type, source_url, byte_size, chunk_count, preview_id, created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function countStagingUploads(siteId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("ghostchat_staging_documents")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .in("source_type", ["upload", "paste", "pdf", "notion"]);
  if (error) throw error;
  return count ?? 0;
}

export type StagingDocInsert = {
  filename: string;
  sourceType: string;
  sourceUrl?: string | null;
  byteSize: number;
  contentHash?: string | null;
  previewId?: string | null;
  replacesDocumentId?: string | null;
  chunks: Array<{ title: string; url: string | null; heading?: string | null; content: string; tokenCount: number }>;
};

export async function addStagingDocument(site: Pick<Site, "id">, doc: StagingDocInsert) {
  const { data, error } = await getDb()
    .from("ghostchat_staging_documents")
    .insert({
      site_id: site.id,
      filename: doc.filename,
      source_type: doc.sourceType,
      source_url: doc.sourceUrl ?? null,
      byte_size: doc.byteSize,
      chunk_count: doc.chunks.length,
      content_hash: doc.contentHash ?? null,
      preview_id: doc.previewId ?? null,
      replaces_document_id: doc.replacesDocumentId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  await storeStagingChunks({ site, documentId: data.id, sourceType: doc.sourceType, previewId: doc.previewId, chunks: doc.chunks });
  return data;
}

/** Publish owner-added staging docs (not recrawl preview pages). */
export async function publishStagingTraining(site: Site): Promise<{ published: number; chunks: number }> {
  const { data: docs, error } = await getDb()
    .from("ghostchat_staging_documents")
    .select("id")
    .eq("site_id", site.id)
    .is("preview_id", null);
  if (error) throw error;
  let published = 0;
  let chunks = 0;
  for (const d of docs ?? []) {
    chunks += await promoteStagingDocument(site.id, d.id);
    published += 1;
  }
  await refreshCounts(site.id);
  await refreshStagingCount(site.id);
  return { published, chunks };
}

export async function discardStagingTraining(siteId: string): Promise<number> {
  const { data } = await getDb().from("ghostchat_staging_documents").select("id").eq("site_id", siteId).is("preview_id", null);
  const ids = (data ?? []).map((d: { id: string }) => d.id);
  if (ids.length) await getDb().from("ghostchat_staging_documents").delete().in("id", ids);
  await refreshStagingCount(siteId);
  return ids.length;
}

export async function promoteStagingDocument(siteId: string, stagingDocId: string): Promise<number> {
  const db = getDb();
  const { data: doc, error } = await db.from("ghostchat_staging_documents").select("*").eq("id", stagingDocId).maybeSingle();
  if (error) throw error;
  if (!doc) return 0;
  if (doc.replaces_document_id) {
    await db.from("ghostchat_chunks").delete().eq("document_id", doc.replaces_document_id);
    await db.from("ghostchat_documents").delete().eq("id", doc.replaces_document_id);
  }
  const { data: live, error: insErr } = await db
    .from("ghostchat_documents")
    .insert({
      site_id: siteId,
      filename: doc.filename,
      source_type: doc.source_type,
      source_url: doc.source_url,
      byte_size: doc.byte_size,
      chunk_count: doc.chunk_count,
      content_hash: doc.content_hash,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  const { data: chunks, error: chErr } = await db.from("ghostchat_staging_chunks").select("url, title, heading, content, token_count, source_type, embedding, embedding_model").eq("document_id", stagingDocId);
  if (chErr) throw chErr;
  const rows = (chunks ?? []).map((c: Record<string, unknown>) => ({
    site_id: siteId,
    document_id: live.id,
    url: c.url,
    title: c.title,
    heading: c.heading || null,
    content: c.content,
    token_count: c.token_count,
    source_type: c.source_type,
    embedding: c.embedding,
    embedding_model: c.embedding_model,
  }));
  for (let i = 0; i < rows.length; i += 80) {
    const { error: e } = await db.from("ghostchat_chunks").insert(rows.slice(i, i + 80));
    if (e) throw e;
  }
  await db.from("ghostchat_staging_documents").delete().eq("id", stagingDocId);
  return rows.length;
}

export function mergeRetrieval(live: RetrievedChunk[], staging: RetrievedChunk[], hideUrls: string[]): RetrievedChunk[] {
  const hide = new Set(hideUrls.map((u) => normPageUrl(u)).filter(Boolean));
  const stagingUrls = new Set(staging.map((c) => (c.url ? normPageUrl(c.url) : "")).filter(Boolean));
  const filtered = live.filter((c) => {
    if (!c.url) return true;
    const u = normPageUrl(c.url);
    if (hide.has(u)) return false;
    if (stagingUrls.has(u)) return false;
    return true;
  });
  return [...staging, ...filtered].sort((a, b) => b.similarity - a.similarity).slice(0, 8);
}

export async function matchStagingChunks(siteId: string, embedding: number[], query: string): Promise<RetrievedChunk[]> {
  const { data, error } = await getDb().rpc("ghostchat_hybrid_staging_chunks", {
    query_embedding: embedding,
    query_text: query,
    match_site_id: siteId,
    match_count: 6,
    match_threshold: 0.2,
  });
  if (error) return [];
  return (data ?? []) as RetrievedChunk[];
}
