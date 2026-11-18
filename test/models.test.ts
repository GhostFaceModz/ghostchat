import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  resolveChatModel,
  resolveEmbeddingModel,
  isProviderEnabled,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
  EMBEDDING_DIMENSIONS,
} from "../server/src/lib/models.ts";

const saved: Record<string, string | undefined> = {};
const keys = [
  "GROK_API_KEY",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "AI_API_KEY",
  "AI_PROVIDER",
  "OPENROUTER_MODEL",
  "EMBEDDING_PROVIDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
];

before(() => {
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

after(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("default chat provider is OpenRouter DeepSeek V4 Flash", () => {
  assert.equal(DEFAULT_CHAT_PROVIDER, "openrouter");
  assert.equal(DEFAULT_CHAT_MODEL, "deepseek/deepseek-v4-flash");
  assert.equal(EMBEDDING_DIMENSIONS, 384);
});

test("enabled providers follow whichever keys are set", () => {
  process.env.OPENROUTER_API_KEY = "or-test";
  assert.equal(isProviderEnabled("openrouter"), true);
  assert.equal(isProviderEnabled("grok"), false);
  delete process.env.OPENROUTER_API_KEY;
});

test("falls back to OpenRouter when the chosen provider has no key", () => {
  process.env.OPENROUTER_API_KEY = "or-test";
  const resolved = resolveChatModel({ chat_provider: "openai", chat_model: "gpt-4o-mini" });
  assert.equal(resolved.provider, "openrouter");
  assert.equal(resolved.model, DEFAULT_CHAT_MODEL);
  assert.equal(resolved.baseUrl, "https://openrouter.ai/api/v1");
  assert.ok(resolved.fallbackFrom);
  delete process.env.OPENROUTER_API_KEY;
});

test("uses the owner's OpenRouter pick when the key is present", () => {
  process.env.OPENROUTER_API_KEY = "or-test";
  const resolved = resolveChatModel({
    chat_provider: "openrouter",
    chat_model: "google/gemma-4-31b-it:free",
  });
  assert.equal(resolved.provider, "openrouter");
  assert.equal(resolved.model, "google/gemma-4-31b-it:free");
  assert.equal(resolved.fallbackFrom, undefined);
  delete process.env.OPENROUTER_API_KEY;
});

test("defaults embeddings to local hash embeddings when Supabase is not configured", () => {
  const resolved = resolveEmbeddingModel();
  assert.equal(resolved.provider, "local");
  assert.equal(resolved.model, "hash/feature-384");
  assert.equal(resolved.apiKey, "");
  assert.equal(resolved.fallbackFrom?.provider, "gte-small");
});

test("falls back to local embeddings when a paid provider has no key", () => {
  process.env.EMBEDDING_PROVIDER = "openai";
  const resolved = resolveEmbeddingModel();
  assert.equal(resolved.provider, "local");
  assert.ok(resolved.fallbackFrom);
  delete process.env.EMBEDDING_PROVIDER;
});
