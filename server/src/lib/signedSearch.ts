import { retrieveChunks } from "./chat.js";
import type { RetrievedChunk } from "../types.js";

export type SearchHit = { title: string | null; url: string | null; heading: string | null; content: string; similarity: number };

export function formatSearchHits(chunks: RetrievedChunk[], topK: number): SearchHit[] {
  return chunks.slice(0, topK).map((c) => ({
    title: c.title || null,
    url: c.url || null,
    heading: c.heading || null,
    content: String(c.content || "").slice(0, 1200),
    similarity: Math.round((Number(c.similarity) || 0) * 1000) / 1000,
  }));
}

export async function searchKnowledge(siteId: string, query: string, topK = 5): Promise<SearchHit[]> {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (q.length < 2) throw Object.assign(new Error("Write a search query of at least two characters."), { status: 400 });
  const chunks = await retrieveChunks(siteId, q, [], { limit: Math.min(8, Math.max(topK, 6)) });
  return formatSearchHits(chunks, topK);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function mcpResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
export function mcpError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcp(body: Rpc, search: (query: string, topK: number) => Promise<SearchHit[]>) {
  const method = String(body?.method || "");
  const id = body?.id ?? null;
  if (method === "initialize") {
    return mcpResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ghostchat-search", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return mcpResult(id, {});
  if (method === "tools/list") {
    return mcpResult(id, {
      tools: [
        {
          name: "search",
          description: "Search this site's GhostChat knowledge base and return the top matching passages.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "The visitor question or search phrase." },
              top_k: { type: "integer", minimum: 1, maximum: 8, description: "How many passages to return (default 5)." },
            },
            required: ["query"],
          },
        },
      ],
    });
  }
  if (method === "tools/call") {
    const name = String((body.params as { name?: string } | undefined)?.name || "");
    const args = ((body.params as { arguments?: Record<string, unknown> } | undefined)?.arguments || {}) as Record<string, unknown>;
    if (name !== "search") return mcpError(id, -32601, "Unknown tool.");
    const hits = await search(String(args.query || ""), Number(args.top_k) || 5);
    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }] });
  }
  if (!method) return mcpError(id, -32600, "Missing method.");
  return mcpError(id, -32601, "Method not found.");
}
