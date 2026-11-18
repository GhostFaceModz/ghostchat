import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modelCreditCost, creditLabel } from "../server/src/lib/credits.ts";
import { decideSend } from "../server/src/lib/usage.ts";
import { planFromKnownIds } from "../server/src/lib/whop.ts";
import { encryptSecret, decryptSecret, keyHint, looksLikeApiKey } from "../server/src/lib/byok.ts";
import { isAutoModel, looksHardQuestion, pickAutoRoute, AUTO_MODEL_ID } from "../server/src/lib/autoRoute.ts";
import { canRecharge, creditsLookLow, packPrice, utcMonth, normalizeSettings } from "../server/src/lib/autoRecharge.ts";
import { publicModelCatalog } from "../server/src/lib/models.ts";

test("model credit weights are 1, 2, 3 or 5", () => {
  assert.equal(modelCreditCost("openrouter", "deepseek/deepseek-v4-flash"), 1);
  assert.equal(modelCreditCost("openrouter", "openrouter/free"), 1);
  assert.equal(modelCreditCost("openrouter", "google/gemma-4-31b-it:free"), 1);
  assert.equal(modelCreditCost("openrouter", "openai/gpt-4o-mini"), 1);
  assert.equal(modelCreditCost("openrouter", "google/gemini-2.5-flash"), 1);
  assert.equal(modelCreditCost("openai", "gpt-4o-mini"), 1);
  assert.equal(modelCreditCost("openrouter", AUTO_MODEL_ID), 1);
  assert.equal(modelCreditCost("openrouter", "anthropic/claude-haiku-4.5"), 2);
  assert.equal(modelCreditCost("openrouter", "openai/gpt-4o"), 3);
  assert.equal(modelCreditCost("openrouter", "google/gemini-2.5-pro"), 3);
  assert.equal(modelCreditCost("openrouter", "x-ai/grok-4.7"), 3);
  assert.equal(modelCreditCost("openai", "gpt-4.1-mini"), 3);
  assert.equal(modelCreditCost("openai", "gpt-4.1"), 5);
  assert.equal(modelCreditCost("openrouter", "anthropic/claude-opus-4"), 5);
  assert.equal(creditLabel(5), "5 credits / reply");
});

test("decideSend accounts for weighted costs", () => {
  assert.equal(decideSend(199, 200, 0, 1).reason, "allowance");
  assert.equal(decideSend(199, 200, 0, 2).reason, "grace");
  assert.equal(decideSend(200, 200, 5, 5).reason, "credits");
  assert.equal(decideSend(200, 200, 2, 5).reason, "grace");
  assert.deepEqual(decideSend(220, 200, 0, 1), { ok: false, reason: "paused" });
  assert.deepEqual(decideSend(216, 200, 0, 5), { ok: false, reason: "paused" });
});

test("yearly Whop plan IDs map to Pro and Business", () => {
  const known = { pro: ["plan_pro_mo", "plan_pro_yr"], business: ["plan_biz_mo", "plan_biz_yr"] };
  assert.equal(planFromKnownIds("plan_pro_mo", null, known), "pro");
  assert.equal(planFromKnownIds("plan_pro_yr", null, known), "pro");
  assert.equal(planFromKnownIds("plan_biz_yr", null, known), "business");
  assert.equal(planFromKnownIds("unknown", null, known), null);
});

test("BYOK encrypts and decrypts, and never stores the raw key in the hint", () => {
  process.env.BYOK_ENCRYPTION_KEY = "a".repeat(64);
  const secret = "sk-or-v1-test-key-not-real-aaaaaaaa";
  const packed = encryptSecret(secret);
  assert.match(packed, /^v1:/);
  assert.equal(packed.includes(secret), false);
  assert.equal(decryptSecret(packed), secret);
  assert.equal(keyHint(secret).includes(secret), false);
  assert.match(keyHint(secret), /aaaa$/);
  assert.equal(looksLikeApiKey("openai", "sk-live-abcdefghijklmnopqrstuv"), true);
  assert.equal(looksLikeApiKey("openai", "not-a-key"), false);
  delete process.env.BYOK_ENCRYPTION_KEY;
});

test("Auto route stays cheap unless the question looks hard", () => {
  assert.equal(isAutoModel("auto"), true);
  assert.equal(isAutoModel(""), true);
  assert.equal(isAutoModel("deepseek/deepseek-v4-flash"), false);
  assert.equal(looksHardQuestion("Hi"), false);
  assert.equal(looksHardQuestion("Compare the Pro and Business plans step by step and explain the difference between them"), true);
  const easy = pickAutoRoute({ openrouter: true }, { hard: false });
  assert.equal(easy.escalated, false);
  assert.match(easy.chat_model, /deepseek-v4-flash/);
  const hard = pickAutoRoute({ openrouter: true }, { hard: true });
  assert.equal(hard.escalated, true);
  assert.equal(hard.chat_model, "openai/gpt-4o-mini");
});

test("auto-recharge respects the monthly cap and low-credit threshold", () => {
  assert.equal(packPrice(1000), 5);
  assert.equal(packPrice(5000), 15);
  assert.equal(canRecharge({ enabled: true, pack: 1000, capGbp: 15, spentGbp: 0, month: utcMonth() }).ok, true);
  assert.equal(canRecharge({ enabled: true, pack: 5000, capGbp: 15, spentGbp: 5, month: utcMonth() }).ok, false);
  assert.equal(canRecharge({ enabled: false, pack: 1000, capGbp: 15, spentGbp: 0, month: utcMonth() }).ok, false);
  assert.equal(creditsLookLow(4900, 5000, 50), true);
  assert.equal(creditsLookLow(10, 5000, 4000), false);
  const s = normalizeSettings({ enabled: "yes", pack: 999, capGbp: 999 });
  assert.equal(s.pack, 1000);
  assert.equal(s.capGbp, 150);
});

test("model catalog includes Auto, recommended defaults, and credit costs", () => {
  const cat = publicModelCatalog();
  const or = cat.providers.find((p) => p.id === "openrouter");
  assert.ok(or);
  assert.ok(or!.models.some((m) => m.id === "auto" && m.recommended && m.credits === 1));
  const flash = or!.models.find((m) => m.id === "deepseek/deepseek-v4-flash");
  assert.equal(flash?.credits, 1);
  assert.equal(flash?.recommended, true);
});

test("landing and dashboard show yearly prices, credit weights, Auto and BYOK", () => {
  const html = readFileSync("public/index.html", "utf8");
  assert.match(html, /£90/);
  assert.match(html, /£290/);
  assert.match(html, /2 months free/);
  assert.match(html, /#plans \.plan\.reveal \{ opacity: 1; transform: none; \}/);
  assert.match(html, /@media \(max-width: 900px\)/);
  assert.match(html, /1,000 credits/);
  const dash = readFileSync("dashboard/index.html", "utf8");
  assert.match(dash, /acct-auto-recharge/);
  assert.match(dash, /acct-byok/);
  const js = readFileSync("dashboard/app.js", "utf8");
  assert.match(js, /data-interval='yearly'/);
  assert.match(js, /auto-recharge-form/);
  assert.match(js, /byok-form/);
  assert.match(js, /credits/);
  assert.match(js, /Recommended/);
});
