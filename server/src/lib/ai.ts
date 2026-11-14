import { config } from "../config.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function aiFetch(path: string, body: unknown, stream = false): Promise<Response> {
  if (!config.aiApiKey) {
    throw new Error("AI_API_KEY is not set");
  }
  const res = await fetch(`${config.aiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.aiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  if (stream && !res.body) throw new Error("AI provider did not return a stream");
  return res;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const vectors: number[][] = [];
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const input = texts.slice(i, i + batchSize);
    const res = await aiFetch("/embeddings", {
      model: config.embeddingModel,
      input,
    });
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of ordered) vectors.push(row.embedding);
  }
  return vectors;
}

export async function completeChat(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const res = await aiFetch("/chat/completions", {
    model: config.aiModel,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens ?? 700,
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function* streamChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number },
): AsyncGenerator<string> {
  const res = await aiFetch(
    "/chat/completions",
    {
      model: config.aiModel,
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
