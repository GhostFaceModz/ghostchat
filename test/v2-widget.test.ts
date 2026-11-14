import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");

test("widget parses and stays dependency-free", () => {
  new vm.Script(src);
  assert.doesNotMatch(src, /\bimport\s|require\(/);
});

test("widget handles live lookup status and reset events", () => {
  assert.match(src, /ev\.type === "status" && ev\.status === "checking"/);
  assert.match(src, /ev\.type === "reset"/);
  assert.match(src, /checking: "Checking the site…"/);
});

test("widget translates UI strings for the main languages", () => {
  for (const l of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) assert.match(src, new RegExp(`\\n\\s+${l}: \\{ ph:`));
  assert.match(src, /lang: \(navigator\.language/);
});

test("widget memory: anonymous visitor id, opt-out and forget", () => {
  assert.match(src, /gc_vid_/);
  assert.match(src, /gc_mem_off_/);
  assert.match(src, /\/api\/chat\/forget/);
  assert.match(src, /memory: state\.memory && !state\.memoryOff/);
});

test("widget greetings, owner forms, CSAT and voice fallback", () => {
  assert.match(src, /gc_greet_/);
  assert.match(src, /card\.kind === "support"/);
  assert.match(src, /\/api\/chat\/csat/);
  assert.match(src, /micBlocked/);
  assert.match(src, /gc-listening/);
});
