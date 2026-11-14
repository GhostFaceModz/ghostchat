/**
 * Lightweight free local embeddings for GhostChat.
 * Uses feature hashing (no ML model) so it fits free-tier RAM (Render/Fly).
 * Quality is good enough for FAQ/site retrieval; paid OpenAI/Gemini embeddings
 * remain available via env for higher quality.
 */
export const LOCAL_EMBEDDING_MODEL = "hash/feature-384";
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** FNV-1a 32-bit hash */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function embedOne(text: string): number[] {
  const vec = new Float64Array(LOCAL_EMBEDDING_DIMENSIONS);
  const tokens = tokenize(text.slice(0, 8000));
  if (tokens.length === 0) return Array.from(vec);

  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % LOCAL_EMBEDDING_DIMENSIONS;
    const sign = (h & 1) === 0 ? 1 : -1;
    // simple TF boost for repeats via additive updates
    vec[idx] += sign;
    // bigram-ish: fold with next char of token for a bit more signal
    if (token.length > 3) {
      const h2 = hashToken(token.slice(0, 3));
      vec[h2 % LOCAL_EMBEDDING_DIMENSIONS] += sign * 0.5;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(LOCAL_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

export async function warmupLocalEmbeddings(): Promise<void> {
  // no-op: hash embeddings need no model load
}

export async function localEmbed(texts: string[]): Promise<number[][]> {
  return texts.map(embedOne);
}
