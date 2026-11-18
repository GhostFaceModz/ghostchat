/** Training recycle bin: soft-delete documents for 7 days, then purge. */
import { getDb } from "./supabase.js";
import { refreshCounts } from "./indexer.js";

export const RECYCLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function purgeAt(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + RECYCLE_AFTER_MS).toISOString();
}

export async function listDeletedDocuments(siteId: string) {
  await purgeExpiredDocuments(siteId).catch(() => {});
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .select("id, filename, source_type, source_url, chunk_count, deleted_at")
    .eq("site_id", siteId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, purge_at: d.deleted_at ? purgeAt(d.deleted_at) : null }));
}

export async function softDeleteDocument(siteId: string, docId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Document not found."), { status: 404 });
  await refreshCounts(siteId);
  return data;
}

export async function restoreDocument(siteId: string, docId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .update({ deleted_at: null })
    .eq("id", docId)
    .eq("site_id", siteId)
    .not("deleted_at", "is", null)
    .select("id, filename, source_type, source_url, byte_size, chunk_count, created_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Nothing to restore."), { status: 404 });
  await refreshCounts(siteId);
  return data;
}

export async function purgeDocument(siteId: string, docId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .delete()
    .eq("id", docId)
    .eq("site_id", siteId)
    .not("deleted_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Document not found in the recycle bin."), { status: 404 });
  await refreshCounts(siteId);
  return data;
}

export async function purgeExpiredDocuments(siteId?: string) {
  const cutoff = new Date(Date.now() - RECYCLE_AFTER_MS).toISOString();
  let q = getDb().from("ghostchat_documents").delete().not("deleted_at", "is", null).lt("deleted_at", cutoff).select("id");
  if (siteId) q = q.eq("site_id", siteId);
  const { data, error } = await q;
  if (error) throw error;
  if (siteId && (data ?? []).length) await refreshCounts(siteId);
  return (data ?? []).length;
}
