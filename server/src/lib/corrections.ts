/** "Fix this answer": owner corrections stored as high-priority Q&A and used first in retrieval. */
import { getDb } from "./supabase.js";
import { embedTexts } from "./ai.js";
import { resolveEmbeddingModel } from "./models.js";
import type { RetrievedChunk } from "../types.js";
import { currentEmbeddingModel } from "./embeddingSpace.js";
import { bumpKnowledge } from "./answerCache.js";

export type Correction = { id: string; question: string; answer: string; similarity: number };

/** Corrections must match more closely than ordinary chunks before they are used. */
export function correctionThreshold(): number {
  const env = Number(process.env.CORRECTION_THRESHOLD);
  if (Number.isFinite(env) && env > 0 && env < 1) return env;
  return resolveEmbeddingModel().provider === "local" ? 0.45 : 0.8;
}

export function correctionText(question: string, answer: string): string {
  return `Q: ${question.trim()}\nA: ${answer.trim()}`;
}

/** Turn matched corrections into context chunks that sit above everything else. */
export function correctionChunks(siteId: string, list: Correction[]): RetrievedChunk[] {
  return list.map((c) => ({
    id: `correction:${c.id}`, site_id: siteId, url: null,
    title: "Owner-verified answer",
    content: `OWNER-VERIFIED ANSWER (use this over anything else that disagrees):\n${correctionText(c.question, c.answer)}`,
    similarity: Math.min(1, c.similarity + 0.3),
  }));
}

export async function matchCorrections(siteId: string, embedding: number[]): Promise<Correction[]> {
  if (!embedding?.length) return [];
  const { data, error } = await getDb().rpc("ghostchat_match_corrections", {
    query_embedding: embedding, match_site_id: siteId, match_count: 2, match_threshold: correctionThreshold(),
  });
  if (error) return [];
  return (data ?? []) as Correction[];
}

export async function saveCorrection(siteId: string, input: { question: string; answer: string; logId?: string | null; id?: string | null }) {
  const question = input.question.trim().slice(0, 500);
  const answer = input.answer.trim().slice(0, 4000);
  if (!question || !answer) throw Object.assign(new Error("Add both the question and the corrected answer."), { status: 400 });
  const [embedding] = await embedTexts([question], "query");
  const row = { site_id: siteId, question, answer, log_id: input.logId || null, embedding, embedding_model: currentEmbeddingModel(), updated_at: new Date().toISOString() };
  const db = getDb();
  const q = input.id
    ? db.from("ghostchat_corrections").update(row).eq("id", input.id).eq("site_id", siteId)
    : db.from("ghostchat_corrections").insert(row);
  const { data, error } = await q.select("id, question, answer, log_id, created_at, updated_at").single();
  if (error) throw error;
  await bumpKnowledge(siteId).catch((err) => console.error("knowledge rev:", (err as Error).message));
  return data;
}
