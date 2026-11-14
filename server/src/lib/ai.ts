import { EMBEDDING_DIMENSIONS, resolveChatModel, resolveEmbeddingModel, type ResolvedModel } from "./models.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function aiFetch(resolved: ResolvedModel, path: string, body: unknown, stream = false): Promise<Response> {
  if (!resolved.apiKey) {
    throw new Error(`No API key is configured for ${resolved.provider}.`);
  }
  const res = await fetch(`${resolved.baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resolved.apiKey}`,
      "content-type": "application/json",
      ...resolved.headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  if (stream && !res.body) throw new Error(`${resolved.provider} did not return a stream`);
  return res;
}

export async function embedTexts(texts: string[], kind: "query" | "passage" = "passage"): Promise<number[][]> {
  if (!texts.length) return [];
  const resolved = resolveEmbeddingModel();
  const prefix = kind === "query" ? resolved.queryPrefix : resolved.passagePrefix;
  const input = prefix ? texts.map((t) => (t.startsWith(prefix) ? t : prefix + t)) : texts;
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
  opts?: { maxTokens?: number; temperature?: number; site?: { chat_provider?: string | null; chat_model?: string | null } },
): Promise<string> {
  const resolved = resolveChatModel(opts?.site);
  const res = await aiFetch(resolved, "/chat/completions", {
    model: resolved.model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens ?? 700,
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
  while (true) {
    const { done, value } = await reader.read();
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
