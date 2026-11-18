/**
 * The live retrieval index must stay in one embedding space.
 * New queries and writes follow the active model in ghostchat_settings.
 * When gte-small is configured, a one-shot job re-embeds existing rows, then flips the space.
 */
import { getDb } from "./supabase.js";
import { gteConfigured, gteEmbed, GTE_MODEL } from "./gteEmbeddings.js";
import { localEmbed, LOCAL_EMBEDDING_MODEL } from "./localEmbeddings.js";
import { resolveEmbeddingModel } from "./models.js";

const SETTING_KEY = "embedding_model";
const HASH = LOCAL_EMBEDDING_MODEL;
const GTE = GTE_MODEL;

let cached: string | null = null;

export function currentEmbeddingModel(): string {
  return cached || HASH;
}

export function _resetEmbeddingSpaceCache(): void {
  cached = null;
}

export async function loadEmbeddingSpace(): Promise<string> {
  if (cached) return cached;
  try {
    const { data, error } = await getDb().from("ghostchat_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
    if (error) throw error;
    cached = data?.value === GTE ? GTE : HASH;
  } catch {
    cached = HASH;
  }
  return cached;
}

async function setEmbeddingSpace(model: string): Promise<void> {
  const { error } = await getDb().from("ghostchat_settings").upsert({
    key: SETTING_KEY,
    value: model,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  cached = model;
}

type EmbedRow = { id: string; content?: string | null; question?: string | null; answer?: string | null };

async function reembedTable(
  table: "ghostchat_chunks" | "ghostchat_corrections",
  textsOf: (row: EmbedRow) => string,
): Promise<number> {
  const db = getDb();
  let updated = 0;
  for (;;) {
    const { data, error } = await db.from(table)
      .select("*")
      .or("embedding_model.is.null,embedding_model.neq.gte-small")
      .limit(32);
    if (error) throw error;
    const rows = (data ?? []) as unknown as EmbedRow[];
    if (!rows.length) break;
    const texts = rows.map((r) => textsOf(r).slice(0, 2000) || " ");
    const vectors = await gteEmbed(texts);
    for (let i = 0; i < rows.length; i++) {
      const { error: up } = await db.from(table).update({ embedding: vectors[i], embedding_model: GTE }).eq("id", rows[i].id);
      if (up) throw up;
    }
    updated += rows.length;
  }
  return updated;
}

export type PromoteResult = {
  active: string;
  skipped?: string;
  chunks?: number;
  corrections?: number;
};

/** Re-embed leftover hash vectors with gte-small, then flip the live space. No-op in tests. */
export async function promoteGteEmbeddings(): Promise<PromoteResult> {
  if (process.env.NODE_ENV === "test") return { active: currentEmbeddingModel(), skipped: "test" };
  await loadEmbeddingSpace();
  const resolved = resolveEmbeddingModel();
  if (resolved.provider !== "gte-small" || !gteConfigured()) {
    return { active: currentEmbeddingModel(), skipped: "gte-small is not the configured provider" };
  }
  try {
    await gteEmbed(["ghostchat"]);
  } catch (err) {
    return { active: currentEmbeddingModel(), skipped: `gte-small probe failed: ${(err as Error).message}` };
  }
  const chunks = await reembedTable("ghostchat_chunks", (r) => String(r.content || ""));
  const corrections = await reembedTable("ghostchat_corrections", (r) => `${r.question || ""}
${r.answer || ""}`.trim());
  await setEmbeddingSpace(GTE);
  return { active: GTE, chunks, corrections };
}

/** Encode texts in the live space (hash until promotion finishes, then gte-small). */
export async function embedInActiveSpace(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const resolved = resolveEmbeddingModel();
  if (resolved.provider === "gte-small") {
    const active = cached ?? (await loadEmbeddingSpace());
    if (active === GTE) return gteEmbed(texts);
  }
  if (resolved.provider === "local" || resolved.provider === "gte-small") {
    return localEmbed(texts);
  }
  return [];
}

export function activeModelLabel(): string {
  return currentEmbeddingModel();
}
