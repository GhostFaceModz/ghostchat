import assert from "node:assert/strict";
import { test } from "node:test";
import { redactPii } from "../server/src/lib/pii.ts";

test("redacts email, phone, and card numbers", () => {
  const out = redactPii("Reach me at ada@example.com or +1 415-555-0100. Card 4242424242424242.");
  assert.match(out, /\[email\]/);
  assert.match(out, /\[phone\]/);
  assert.match(out, /\[card\]/);
  assert.equal(out.includes("ada@example.com"), false);
  assert.equal(out.includes("4242424242424242"), false);
});

test("leaves ordinary text alone", () => {
  assert.equal(redactPii("What are your opening hours?"), "What are your opening hours?");
});
