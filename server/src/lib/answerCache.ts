import { createHash } from "node:crypto";
import { getDb } from "./supabase.js";
import type { ChatSource } from "../types.js";
import type { HistoryTurn } from "./queryRewrite.js";

export type CachedAnswer = {
  answer: string;
  sources: ChatSource[];
  suggestions: string[];
};

const MIN_NORM_LEN = 12;
const PERSONAL = /\b(\d{4,}|[^\s@]+@[^\s@]+\.[^\s@]+|order\s*#?\s*\d+|my (account|order|booking|ticket))\b/i;

/** Lowercase, strip URLs and punctuation, collapse space. */
export function normalizeQuestion(q: string): string {
  return String(q || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionHash(norm: string): string {
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** Follow-ups and personal/account questions must not be served from the cache. */
export function canUseAnswerCache(message: string, history: HistoryTurn[] = []): boolean {
  const norm = normalizeQuestion(message);
  if (norm.length < MIN_NORM_LEN) return false;
  if (PERSONAL.test(message)) return false;
  const prior = history.filter((t) => t.role === "user" && normalizeQuestion(t.content) && normalizeQuestion(t.content) !== norm);
  return prior.length === 0;
}

export function shouldStoreAnswer(opts: { answer: string; unsure: boolean; message: string; history?: HistoryTurn[] }): boolean {
  if (opts.unsure) return false;
  if (!opts.answer.trim()) return false;
  return canUseAnswerCache(opts.message, opts.history);
}

export async function knowledgeRev(siteId: string): Promise<number> {
  const { data } = await getDb().from("ghostchat_sites").select("knowledge_rev").eq("id", siteId).maybeSingle();
  return Number(data?.knowledge_rev || 0);
}

export async function bumpKnowledge(siteId: string): Promise<void> {
  const { data } = await getDb().from("ghostchat_sites").select("knowledge_rev").eq("id", siteId).maybeSingle();
  const next = Number(data?.knowledge_rev || 0) + 1;
  await getDb().from("ghostchat_sites").update({ knowledge_rev: next, updated_at: new Date().toISOString() }).eq("id", siteId);
}

export async function lookupCachedAnswer(siteId: string, message: string, history: HistoryTurn[] = []): Promise<CachedAnswer | null> {
  if (!canUseAnswerCache(message, history)) return null;
  const norm = normalizeQuestion(message);
  const hash = questionHash(norm);
  const rev = await knowledgeRev(siteId);
  const { data, error } = await getDb()
    .from("ghostchat_answer_cache")
    .select("id, answer, sources, suggestions, hits")
    .eq("site_id", siteId)
    .eq("query_hash", hash)
    .eq("knowledge_rev", rev)
    .maybeSingle();
  if (error || !data) return null;
  await getDb()
    .from("ghostchat_answer_cache")
    .update({ hits: (data.hits || 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  return {
    answer: data.answer,
    sources: Array.isArray(data.sources) ? data.sources as ChatSource[] : [],
    suggestions: Array.isArray(data.suggestions) ? data.suggestions as string[] : [],
  };
}

export async function storeCachedAnswer(
  siteId: string,
  message: string,
  cached: CachedAnswer,
  opts: { unsure: boolean; history?: HistoryTurn[] },
): Promise<void> {
  if (!shouldStoreAnswer({ answer: cached.answer, unsure: opts.unsure, message, history: opts.history })) return;
  const norm = normalizeQuestion(message);
  const hash = questionHash(norm);
  const rev = await knowledgeRev(siteId);
  await getDb().from("ghostchat_answer_cache").upsert({
    site_id: siteId,
    query_hash: hash,
    query_norm: norm.slice(0, 400),
    answer: cached.answer.slice(0, 8000),
    sources: cached.sources || [],
    suggestions: cached.suggestions || [],
    knowledge_rev: rev,
    updated_at: new Date().toISOString(),
  }, { onConflict: "site_id,query_hash,knowledge_rev" });
}
