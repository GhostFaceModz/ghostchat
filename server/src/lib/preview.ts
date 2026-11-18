/** Recrawl preview and diff: scheduled and later manual recrawls wait for owner approval. */
import { getDb } from "./supabase.js";
import { contentHash, indexPages, pageChunks, planIncremental, refreshCounts } from "./indexer.js";
import type { CrawledPage, CrawlIssue, CrawlScope } from "./crawl.js";
import { faqCandidatesFromPages, saveFaqDrafts, type FaqCandidate } from "./faqDrafts.js";
import { addStagingDocument, promoteStagingDocument, refreshStagingCount } from "./staging.js";
import type { Site } from "../types.js";

export type DiffEntry = { url: string; title: string; documentId?: string };
export type PreviewDiff = {
  added: DiffEntry[];
  updated: DiffEntry[];
  removed: DiffEntry[];
  unchanged: number;
  pages: number;
  broken?: CrawlIssue[];
  redirects?: CrawlIssue[];
};

export function attachCrawlIssues(diff: PreviewDiff, issues: CrawlIssue[] | undefined): PreviewDiff {
  const list = issues || [];
  const redirects = list.filter((i) => i.reason === "redirect" || i.reason === "redirect_offsite").slice(0, 40);
  const broken = list.filter((i) => i.reason !== "redirect" && i.reason !== "redirect_offsite").slice(0, 40);
  return { ...diff, broken, redirects };
}

type ExistingDoc = { id: string; source_url: string | null; content_hash: string | null; source_type: string; filename?: string | null };

export function diffFromPlan(plan: ReturnType<typeof planIncremental>, existing: ExistingDoc[]): PreviewDiff {
  const byId = new Map(existing.map((d) => [d.id, d]));
  return {
    added: plan.add.map((p) => ({ url: p.url, title: p.title })),
    updated: plan.replace.map((r) => ({ url: r.page.url, title: r.page.title, documentId: r.doc.id })),
    removed: plan.remove.map((id) => {
      const d = byId.get(id);
      return { url: d?.source_url || "", title: d?.filename || "", documentId: id };
    }),
    unchanged: plan.unchanged.length,
    pages: plan.add.length + plan.replace.length + plan.unchanged.length,
  };
}

export function previewIsUnchanged(diff: PreviewDiff): boolean {
  return diff.added.length + diff.updated.length + diff.removed.length === 0;
}

export function hideUrlsFromDiff(diff: { updated?: Array<{ url?: string }>; removed?: Array<{ url?: string }> } | null | undefined): string[] {
  if (!diff) return [];
  return [...(diff.updated || []), ...(diff.removed || [])].map((e) => e.url || "").filter(Boolean);
}

export async function hasCrawlDocuments(siteId: string): Promise<boolean> {
  const { count } = await getDb().from("ghostchat_documents").select("id", { count: "exact", head: true }).eq("site_id", siteId).eq("source_type", "crawl").is("deleted_at", null);
  if (count) return true;
  const lookup = await getDb().from("ghostchat_documents").select("id", { count: "exact", head: true }).eq("site_id", siteId).eq("source_type", "lookup").is("deleted_at", null);
  return (lookup.count ?? 0) > 0;
}

export async function latestPreview(siteId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_crawl_previews")
    .select("*")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function pendingPreview(siteId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_crawl_previews")
    .select("*")
    .eq("site_id", siteId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function clearPendingPreview(siteId: string): Promise<void> {
  const pending = await pendingPreview(siteId);
  if (!pending) return;
  await getDb().from("ghostchat_staging_documents").delete().eq("preview_id", pending.id);
  await getDb().from("ghostchat_crawl_previews").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", pending.id);
}

export type IngestResult = {
  mode: "applied" | "preview" | "unchanged";
  summary: { added: number; updated: number; unchanged: number; removed: number; chunks: number };
  faqDrafts: number;
  preview: Record<string, unknown> | null;
  issues: { broken: CrawlIssue[]; redirects: CrawlIssue[] };
};

/** First crawl applies immediately. A recrawl writes a preview unless nothing changed. */
export async function ingestCrawl(
  site: Site,
  pages: CrawledPage[],
  opts: { trigger: "manual" | "scheduled"; scope?: CrawlScope; issues?: CrawlIssue[] },
): Promise<IngestResult> {
  if (!pages.length) throw new Error("No usable text was found on the site.");
  const existingLive = await hasCrawlDocuments(site.id);
  if (!existingLive) {
    const summary = await indexPages(site, pages, { sourceType: "crawl", removeMissing: true, scope: opts.scope });
    const faqDrafts = await saveFaqDrafts(site.id, faqCandidatesFromPages(pages)).catch((err) => {
      console.error("faq drafts:", (err as Error).message);
      return 0;
    });
    await markCrawlReady(site.id, { previewStatus: null });
    const split = attachCrawlIssues({ added: [], updated: [], removed: [], unchanged: 0, pages: pages.length }, opts.issues);
    return { mode: "applied", summary, faqDrafts, preview: null, issues: { broken: split.broken || [], redirects: split.redirects || [] } };
  }
  const preview = await buildCrawlPreview(site, pages, opts);
  const summary = { added: preview.added, updated: preview.updated, unchanged: preview.unchanged, removed: preview.removed, chunks: preview.chunks };
  const previewDiff = (preview?.diff || {}) as PreviewDiff;
  return {
    mode: preview.status === "unchanged" ? "unchanged" : "preview",
    summary,
    faqDrafts: 0,
    preview,
    issues: { broken: previewDiff.broken || [], redirects: previewDiff.redirects || [] },
  };
}

export async function markCrawlReady(siteId: string, opts: { previewStatus: string | null; error?: string | null }) {
  await getDb()
    .from("ghostchat_sites")
    .update({
      crawl_status: opts.error ? "error" : "ready",
      crawl_error: opts.error ?? null,
      last_crawled_at: new Date().toISOString(),
      preview_status: opts.previewStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
}

async function loadExistingDocs(siteId: string): Promise<ExistingDoc[]> {
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .select("id, source_url, content_hash, source_type, filename")
    .eq("site_id", siteId)
    .in("source_type", ["crawl", "lookup"])
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as ExistingDoc[];
}

export async function buildCrawlPreview(site: Site, pages: CrawledPage[], opts: { trigger: "manual" | "scheduled"; scope?: CrawlScope; issues?: CrawlIssue[] }) {
  const existing = await loadExistingDocs(site.id);
  const plan = planIncremental(existing, pages, { removeMissing: true });
  const diff = attachCrawlIssues(diffFromPlan(plan, existing), opts.issues);
  const faqs = faqCandidatesFromPages(pages);
  const now = new Date().toISOString();

  await clearPendingPreview(site.id);

  if (previewIsUnchanged(diff)) {
    const { data, error } = await getDb()
      .from("ghostchat_crawl_previews")
      .insert({
        site_id: site.id,
        status: "unchanged",
        trigger: opts.trigger,
        added: 0,
        updated: 0,
        unchanged: diff.unchanged,
        removed: 0,
        pages: diff.pages,
        chunks: 0,
        diff,
        faq_candidates: faqs,
        finished_at: now,
      })
      .select("*")
      .single();
    if (error) throw error;
    await markCrawlReady(site.id, { previewStatus: "unchanged" });
    return data;
  }

  const { data: row, error } = await getDb()
    .from("ghostchat_crawl_previews")
    .insert({
      site_id: site.id,
      status: "pending",
      trigger: opts.trigger,
      added: diff.added.length,
      updated: diff.updated.length,
      unchanged: diff.unchanged,
      removed: diff.removed.length,
      pages: diff.pages,
      chunks: 0,
      diff,
      faq_candidates: faqs,
    })
    .select("*")
    .single();
  if (error) throw error;

  let chunkCount = 0;
  const write = async (page: CrawledPage, replaces?: string) => {
    const list = pageChunks(page, opts.scope);
    if (!list.length) return;
    await addStagingDocument(site, {
      filename: page.title.slice(0, 300) || page.url,
      sourceType: "crawl",
      sourceUrl: page.url,
      byteSize: page.text.length,
      contentHash: contentHash(page.text),
      previewId: row.id,
      replacesDocumentId: replaces || null,
      chunks: list,
    });
    chunkCount += list.length;
  };
  for (const page of plan.add) await write(page);
  for (const r of plan.replace) await write(r.page, r.doc.id);

  const { data: finished, error: upErr } = await getDb()
    .from("ghostchat_crawl_previews")
    .update({ chunks: chunkCount, finished_at: now, diff })
    .eq("id", row.id)
    .select("*")
    .single();
  if (upErr) throw upErr;
  await refreshStagingCount(site.id);
  await markCrawlReady(site.id, { previewStatus: "pending" });
  return finished;
}

export async function approvePreview(site: Site, previewId?: string) {
  const preview = previewId
    ? (await getDb().from("ghostchat_crawl_previews").select("*").eq("id", previewId).eq("site_id", site.id).maybeSingle()).data
    : await pendingPreview(site.id);
  if (!preview || preview.status !== "pending") throw Object.assign(new Error("There is no recrawl waiting for approval."), { status: 404 });

  const diff = (preview.diff || {}) as PreviewDiff;
  const removeIds = [...(diff.removed || []).map((e) => e.documentId).filter(Boolean), ...(diff.updated || []).map((e) => e.documentId).filter(Boolean)] as string[];
  // Updated pages are also replaced when promoting staging docs (replaces_document_id).
  // Still drop any removed live docs first.
  if (diff.removed?.length) {
    const ids = diff.removed.map((e) => e.documentId).filter(Boolean) as string[];
    if (ids.length) {
      await getDb().from("ghostchat_chunks").delete().in("document_id", ids);
      await getDb().from("ghostchat_documents").delete().in("id", ids);
    }
  }

  const { data: docs, error } = await getDb().from("ghostchat_staging_documents").select("id").eq("preview_id", preview.id);
  if (error) throw error;
  let chunks = 0;
  for (const d of docs ?? []) chunks += await promoteStagingDocument(site.id, d.id);

  const faqs = (preview.faq_candidates || []) as FaqCandidate[];
  const faqDrafts = faqs.length ? await saveFaqDrafts(site.id, faqs).catch((err) => { console.error("faq drafts:", (err as Error).message); return 0; }) : 0;

  await getDb()
    .from("ghostchat_crawl_previews")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", preview.id);
  await refreshCounts(site.id);
  await refreshStagingCount(site.id);
  await getDb().from("ghostchat_sites").update({ preview_status: null, updated_at: new Date().toISOString() }).eq("id", site.id);
  void removeIds;
  return { previewId: preview.id, chunks, faqDrafts, diff };
}

export async function rejectPreview(site: Site, previewId?: string) {
  const preview = previewId
    ? (await getDb().from("ghostchat_crawl_previews").select("*").eq("id", previewId).eq("site_id", site.id).maybeSingle()).data
    : await pendingPreview(site.id);
  if (!preview || preview.status !== "pending") throw Object.assign(new Error("There is no recrawl waiting for approval."), { status: 404 });
  await getDb().from("ghostchat_staging_documents").delete().eq("preview_id", preview.id);
  await getDb().from("ghostchat_crawl_previews").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", preview.id);
  await refreshStagingCount(site.id);
  await getDb().from("ghostchat_sites").update({ preview_status: null, updated_at: new Date().toISOString() }).eq("id", site.id);
  return { previewId: preview.id, discarded: true };
}

