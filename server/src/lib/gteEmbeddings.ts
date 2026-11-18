/** Call the free Supabase Edge Function that runs gte-small (384-d). */
import { config } from "../config.js";

const EMBEDDING_DIMENSIONS = 384;

export const GTE_FUNCTION = "ghostchat-embed";
export const GTE_MODEL = "gte-small";
const BATCH = 1;

export function gteConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

export async function gteEmbed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (!gteConfigured()) throw new Error("Supabase is not configured for gte-small embeddings.");
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${GTE_FUNCTION}`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.supabaseServiceKey}`,
        apikey: config.supabaseServiceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ texts: batch }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`gte-small embed failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { embeddings?: number[][] };
    const vectors = json.embeddings || [];
    if (vectors.length !== batch.length) throw new Error("gte-small embed returned the wrong number of vectors.");
    for (const vec of vectors) {
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`gte-small returned ${Array.isArray(vec) ? vec.length : 0} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
      }
      out.push(vec);
    }
  }
  return out;
}
