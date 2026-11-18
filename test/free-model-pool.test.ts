import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PREFERRED_FREE_MODELS,
  FREE_POOL_SIZE,
  extractFreeModelIds,
  rankFreeModels,
  availableFreeModels,
  nextFreeInPool,
  recordPoolFailure,
  recordPoolSuccess,
  isCooling,
  clearPoolState,
  setPoolForTests,
  poolHealth,
  refreshFreeModelPool,
  isFreeChatModel,
} from "../server/src/lib/freeModelPool.ts";

test("ranks preferred live models first and caps the pool at 10", () => {
  const live = [
    "liquid/lfm-3-1.7b:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "unknown/new-hotness:free",
    "google/gemma-4-26b-a4b-it:free",
  ];
  const ranked = rankFreeModels(live);
  assert.equal(ranked[0], "nvidia/nemotron-3-ultra-550b-a55b:free");
  assert.equal(ranked[1], "google/gemma-4-31b-it:free");
  assert.equal(ranked[2], "google/gemma-4-26b-a4b-it:free");
  assert.ok(ranked.includes("unknown/new-hotness:free"), "fills remaining slots from the live catalog");
  assert.ok(!ranked.includes("qwen/qwen3-8b:free"), "drops preferred models that are not live");
  assert.ok(ranked.length <= FREE_POOL_SIZE);
  assert.ok(PREFERRED_FREE_MODELS.length >= FREE_POOL_SIZE);
});

test("ignores zero-priced non-chat models such as Lyria", () => {
  const ids = extractFreeModelIds([
    { id: "google/lyria-3-pro-preview", pricing: { prompt: "0", completion: "0" } },
    { id: "google/gemma-4-31b-it:free", pricing: { prompt: "0", completion: "0" } },
    { id: "openrouter/free", pricing: { prompt: "0", completion: "0" } },
  ]);
  assert.deepEqual(ids, ["google/gemma-4-31b-it:free", "openrouter/free"]);
  assert.equal(isFreeChatModel({ id: "google/lyria-3-clip-preview" }), false);
});

test("cooldowns skip a failed model so the next one is tried immediately", () => {
  clearPoolState();
  setPoolForTests(["a:free", "b:free", "c:free"]);
  assert.deepEqual(availableFreeModels(), ["a:free", "b:free", "c:free"]);
  recordPoolFailure("a:free", "429");
  assert.equal(isCooling("a:free"), true);
  assert.deepEqual(availableFreeModels(), ["b:free", "c:free"]);
  assert.equal(nextFreeInPool("a:free"), "b:free");
  recordPoolSuccess("b:free");
  const health = poolHealth();
  assert.equal(health.lastAnswered?.model, "b:free");
  assert.equal(health.members.find((m) => m.id === "a:free")?.cooling, true);
  assert.equal(health.members.find((m) => m.id === "b:free")?.cooling, false);
  clearPoolState();
  assert.equal(isCooling("a:free"), false);
});

test("refresh builds a top-10 pool from a models catalog", async () => {
  clearPoolState();
  const catalog = {
    data: PREFERRED_FREE_MODELS.map((id) => ({ id, pricing: { prompt: "0", completion: "0" } })),
  };
  const fake = (async () => new Response(JSON.stringify(catalog), { status: 200 })) as typeof fetch;
  const pool = await refreshFreeModelPool(fake);
  assert.equal(pool.length, FREE_POOL_SIZE);
  assert.equal(pool[0], PREFERRED_FREE_MODELS[0]);
  assert.deepEqual(pool, PREFERRED_FREE_MODELS.slice(0, FREE_POOL_SIZE));
});

test("a failed catalog refresh keeps the last good pool", async () => {
  clearPoolState();
  setPoolForTests(["kept:free"]);
  const fake = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  const pool = await refreshFreeModelPool(fake);
  assert.deepEqual(pool, ["kept:free"]);
  assert.match(poolHealth().refreshError || "", /500/);
});
