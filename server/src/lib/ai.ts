import { EMBEDDING_DIMENSIONS, resolveChatModel, resolveEmbeddingModel, type ResolvedModel } from "./models.js";
import { localEmbed } from "./localEmbeddings.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Thrown when the AI provider can't answer (after retries); callers show a friendly fallback. */
export class AiUnavailableError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 25_000;
export const AI_MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff before retry n (0-based): ~0.6s then ~1.8s, honouring Retry-After up to 5s. */
export function backoffMs(attempt: number, retryAfter?: string | null): number {
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.min(5000, ra * 1000);
  return Math.round(600 * Math.pow(3, attempt) * (0.8 + Math.random() * 0.4));
}
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

async function aiFetch(resolved: ResolvedModel, path: string, body: unknown, stream = false, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!resolved.apiKey) {
    throw new Error(`No API key is configured for ${resolved.provider}.`);
  }
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    // Timeout covers connecting and the first response; streams get an idle timeout in streamChat.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${resolved.baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${resolved.apiKey}`, "content-type": "application/json", ...resolved.headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastStatus = undefined;
      if (attempt < AI_MAX_RETRIES) { await sleep(backoffMs(attempt)); continue; }
      throw new AiUnavailableError(`${resolved.provider} request failed: ${(err as Error).name === "AbortError" ? "timed out" : (err as Error).message}`);
    }
    clearTimeout(timer);
    if (res.ok) {
      if (stream && !res.body) throw new AiUnavailableError(`${resolved.provider} did not return a stream`);
      return res;
    }
    lastStatus = res.status;
    const text = await res.text().catch(() => "");
    if (isRetryable(res.status) && attempt < AI_MAX_RETRIES) { await sleep(backoffMs(attempt, res.headers.get("retry-after"))); continue; }
    if (isRetryable(res.status)) throw new AiUnavailableError(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    throw new Error(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  throw new AiUnavailableError(`${resolved.provider} request failed`, lastStatus);
}

export const _test = { aiFetch };

export async function embedTexts(texts: string[], kind: "query" | "passage" = "passage"): Promise<number[][]> {
  if (!texts.length) return [];
  const resolved = resolveEmbeddingModel();
  const prefix = kind === "query" ? resolved.queryPrefix : resolved.passagePrefix;
  const input = prefix ? texts.map((t) => (t.startsWith(prefix) ? t : prefix + t)) : texts;
  if (resolved.provider === "local") {
    return localEmbed(input);
  }
  const vectors: number[][] = [];
  const batchSize = 32;
  for (let i = 0; i < input.length; i += batchSize) {
    const batch = input.slice(i, i + batchSize);
    const res = await aiFetch(resolved, "/embeddings", {
      model: resolved.model,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of ordered) {
      if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embeddings from ${resolved.provider}/${resolved.model} returned ${row.embedding.length} dimensions; GhostChat requires ${EMBEDDING_DIMENSIONS}.`,
        );
      }
      vectors.push(row.embedding);
    }
  }
  return vectors;
}

export async function completeChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; json?: boolean; fast?: boolean; site?: { chat_provider?: string | null; chat_model?: string | null } },
): Promise<string> {
  const resolved = resolveChatModel(opts?.site);
  const res = await aiFetch(resolved, "/chat/completions", {
    model: resolved.model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens ?? 700,
    ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    // Utility calls (intent, picks) skip "thinking": faster, cheaper, and the JSON never gets cut off by reasoning tokens.
    ...(opts?.fast && resolved.provider === "openrouter" ? { reasoning: { enabled: false } } : {}),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function* streamChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; site?: { chat_provider?: string | null; chat_model?: string | null } },
): AsyncGenerator<string> {
  const resolved = resolveChatModel(opts?.site);
  const res = await aiFetch(
    resolved,
    "/chat/completions",
    {
      model: resolved.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 700,
      stream: true,
    },
    true,
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const IDLE_MS = 20_000;
  while (true) {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => { idle = setTimeout(() => { reader.cancel().catch(() => {}); reject(new AiUnavailableError("The AI stream stalled")); }, IDLE_MS); }),
    ]).finally(() => clearTimeout(idle));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const token = json.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // ignore partial SSE chunks
      }
    }
  }
}
