import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { resolveChatModel, isProviderEnabled, DEFAULT_CHAT_MODEL } from "../server/src/lib/models.ts";

const saved: Record<string, string | undefined> = {};
const keys = ["GROK_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "AI_API_KEY"];

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

test("enabled providers follow whichever keys are set", () => {
  process.env.OPENROUTER_API_KEY = "or-test";
  assert.equal(isProviderEnabled("openrouter"), true);
  assert.equal(isProviderEnabled("grok"), false);
  delete process.env.OPENROUTER_API_KEY;
});

test("falls back to Grok when the chosen provider has no key", () => {
  process.env.GROK_API_KEY = "grok-test";
  const resolved = resolveChatModel({ chat_provider: "openai", chat_model: "gpt-4o-mini" });
  assert.equal(resolved.provider, "grok");
  assert.equal(resolved.model, DEFAULT_CHAT_MODEL);
  assert.equal(resolved.baseUrl, "https://api.x.ai/v1");
  assert.ok(resolved.fallbackFrom);
  delete process.env.GROK_API_KEY;
});

test("uses the owner's Grok pick when the Grok key is present", () => {
  process.env.XAI_API_KEY = "xai-test";
  const resolved = resolveChatModel({ chat_provider: "grok", chat_model: "grok-4.5" });
  assert.equal(resolved.provider, "grok");
  assert.equal(resolved.model, "grok-4.5");
  assert.equal(resolved.fallbackFrom, undefined);
  delete process.env.XAI_API_KEY;
});
