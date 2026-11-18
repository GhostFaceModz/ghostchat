import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { API_KEY_PREFIX, clampTopK, hashApiKey, looksLikeApiKey } from "../server/src/lib/apiKeys.ts";
import { formatSearchHits, handleMcp, mcpError, type SearchHit } from "../server/src/lib/signedSearch.ts";

test("API keys hash consistently and reject a short or odd token", () => {
  const raw = API_KEY_PREFIX + "ab".repeat(32);
  assert.equal(looksLikeApiKey(raw), true);
  assert.equal(looksLikeApiKey("gcsk_short"), false);
  assert.equal(looksLikeApiKey(""), false);
  const a = hashApiKey(raw);
  const b = hashApiKey(raw);
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(hashApiKey(API_KEY_PREFIX + "cd".repeat(32)), a);
  assert.equal(clampTopK(99), 8);
  assert.equal(clampTopK(0), 1);
  assert.equal(clampTopK("nope"), 5);
});

test("search hits are trimmed and the MCP search tool answers with those hits", async () => {
  const hits = formatSearchHits([
    { id: "1", site_id: "s", url: "https://ex.com/a", title: "Shipping", heading: "Rates", content: "We ship in 3 days. ".repeat(200), similarity: 0.87654 },
  ], 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].content.length, 1200);
  assert.equal(hits[0].similarity, 0.877);
  const listed = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, async () => []);
  assert.match(JSON.stringify(listed), /"name":"search"/);
  const stub: SearchHit[] = [{ title: "FAQ", url: null, heading: null, content: "Yes, we ship to Ireland.", similarity: 0.9 }];
  const called = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "shipping" } } }, async (q) => {
    assert.equal(q, "shipping");
    return stub;
  });
  assert.match(JSON.stringify(called), /Yes, we ship to Ireland/);
  const init = await handleMcp({ jsonrpc: "2.0", id: 3, method: "initialize" }, async () => []);
  assert.match(JSON.stringify(init), /ghostchat-search/);
  const bad = mcpError(9, -32601, "nope");
  assert.equal(bad.error.code, -32601);
});

test("search API, MCP route, Share tab and guide are wired up", () => {
  const routes = readFileSync(new URL("../server/src/routes/v1.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
  const sites = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../public/guide.html", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(routes, /v1Router\.post\("\/search"/);
  assert.match(routes, /v1Router\.post\("\/mcp"/);
  assert.match(index, /\/api\/v1/);
  assert.match(sites, /createApiKey/);
  assert.match(html, /id="api-key-new"/);
  assert.match(js, /\/api-keys/);
  assert.match(guide, /\/api\/v1\/search/);
  assert.match(guide, /\/api\/v1\/mcp/);
  assert.match(i18n, /api\.generate/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
