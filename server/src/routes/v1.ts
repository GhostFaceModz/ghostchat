import { Router } from "express";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import { clampTopK, parsePresentedKey, resolveApiKey } from "../lib/apiKeys.js";
import { handleMcp, searchKnowledge } from "../lib/signedSearch.js";

export const v1Router = Router();

async function requireSearchKey(req: Parameters<typeof parsePresentedKey>[0] & { ip?: string }, res: { status: (n: number) => { json: (b: unknown) => unknown }; json: (b: unknown) => unknown }) {
  const raw = parsePresentedKey(req);
  if (!raw) {
    res.status(401).json({ error: "Send a GhostChat API key as Authorization: Bearer gcsk_… or an X-Api-Key header." });
    return null;
  }
  const key = await resolveApiKey(raw);
  if (!key) {
    res.status(401).json({ error: "That API key is not valid." });
    return null;
  }
  const ip = clientIp(req as never);
  const rl = await rateLimitAsync(`search:${key.id}:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: "Search limit reached. Try again in a few minutes." });
    return null;
  }
  return key;
}

v1Router.post("/search", async (req, res) => {
  const key = await requireSearchKey(req, res);
  if (!key) return;
  try {
    const hits = await searchKnowledge(key.site_id, String(req.body?.query || req.body?.q || ""), clampTopK(req.body?.top_k ?? req.body?.topK));
    res.json({ hits });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message || "Could not search just now." });
  }
});

v1Router.post("/mcp", async (req, res) => {
  const key = await requireSearchKey(req, res);
  if (!key) return;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await handleMcp(body, (query, topK) => searchKnowledge(key.site_id, query, clampTopK(topK)));
    if (out == null) return res.status(204).end();
    res.json(out);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32000, message: (err as Error).message || "Search failed." } });
  }
});
