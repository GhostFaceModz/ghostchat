import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuestion, questionHash, canUseAnswerCache, shouldStoreAnswer } from "../server/src/lib/answerCache.ts";

test("normalizeQuestion is stable for punctuation, case and spacing", () => {
  assert.equal(normalizeQuestion("  How much is Pro?? "), "how much is pro");
  assert.equal(normalizeQuestion("How much is Pro?"), normalizeQuestion("how much is pro"));
  assert.equal(normalizeQuestion("See https://ghostchat.pro/pricing for Pro"), "see for pro");
  assert.equal(questionHash("how much is pro").length, 32);
  assert.equal(questionHash("how much is pro"), questionHash("how much is pro"));
});

test("cache is only used for standalone, non-personal questions", () => {
  assert.equal(canUseAnswerCache("How much does the Pro plan cost each month?"), true);
  assert.equal(canUseAnswerCache("Hi"), false);
  assert.equal(canUseAnswerCache("What's the status of order #18422?"), false);
  assert.equal(canUseAnswerCache("Email me at ada@example.com about Pro"), false);
  assert.equal(canUseAnswerCache("How much does the Pro plan cost?", [
    { role: "user", content: "We are a shop in Manchester" },
    { role: "assistant", content: "Great — how can I help?" },
  ]), false);
  assert.equal(canUseAnswerCache("How much does the Pro plan cost?", [
    { role: "user", content: "How much does the Pro plan cost?" },
  ]), true);
});

test("unsure or empty answers are not stored", () => {
  const msg = "How much does the Pro plan cost each month?";
  assert.equal(shouldStoreAnswer({ answer: "Pro is £9/month + VAT.", unsure: false, message: msg }), true);
  assert.equal(shouldStoreAnswer({ answer: "I'm not sure — I couldn't find that on this site.", unsure: true, message: msg }), false);
  assert.equal(shouldStoreAnswer({ answer: "   ", unsure: false, message: msg }), false);
});
