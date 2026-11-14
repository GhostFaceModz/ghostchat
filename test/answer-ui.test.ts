import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickSources, cleanSourceTitle, sourceLimit, suggestionLimit, maybeSuggestions } from "../server/src/lib/chat.js";
import type { RetrievedChunk, Site } from "../server/src/types.js";

const answer = "Our premium plan costs twelve pounds monthly and includes unlimited streaming, offline downloads and family profiles.";
const chunk = (id: string, url: string | null, title: string, similarity: number, content: string): RetrievedChunk =>
  ({ id, site_id: "s", url, title, similarity, content });
const pricing = "Premium plan: twelve pounds monthly. Includes unlimited streaming, offline downloads, family profiles and more.";

test("defaults: 1 source link, 2 suggestions; owner can pick off/1/3 and 0-3", () => {
  assert.equal(sourceLimit({}), 1);
  assert.equal(sourceLimit({ max_sources: 0 }), 0);
  assert.equal(sourceLimit({ max_sources: 3 }), 3);
  assert.equal(sourceLimit({ max_sources: 7 }), 1);
  assert.equal(suggestionLimit({}), 2);
  assert.equal(suggestionLimit({ max_suggestions: 0 }), 0);
  assert.equal(suggestionLimit({ max_suggestions: 3 }), 3);
  assert.equal(suggestionLimit({ max_suggestions: 9 }), 2);
});

test("one strongly relevant, deduped source by default", () => {
  process.env.SIMILARITY_THRESHOLD = "0.3";
  const chunks = [
    chunk("1", "https://x.com/pricing#plans", "Pricing | GhostFlix – Stream anything", 0.81, pricing),
    chunk("2", "https://x.com/pricing/", "Pricing | GhostFlix", 0.8, pricing),
    chunk("3", "https://x.com/help", "Help", 0.79, "Contact support by email for account questions."),
    chunk("4", "https://x.com/blog", "Blog", 0.55, pricing),
  ];
  assert.deepEqual(pickSources({}, chunks, answer), [{ title: "Pricing", url: "https://x.com/pricing#plans" }]);
  const three = pickSources({ max_sources: 3 }, chunks, answer);
  assert.equal(three.length, 1, "same page twice is one link; unrelated or weak pages are dropped");
  assert.deepEqual(pickSources({ max_sources: 0 }, chunks, answer), []);
  assert.deepEqual(pickSources({}, chunks, "Hi there!"), [], "no links for small talk");
});

test("source titles truncate cleanly", () => {
  const t = cleanSourceTitle("A very long page title that keeps going and going well past sixty characters total", null);
  assert.ok(t.length <= 60 && t.endsWith("…"));
  assert.doesNotMatch(t, /\s…$/);
  assert.equal(cleanSourceTitle("", "https://x.com/help/reset-password"), "reset password");
});

test("suggestions respect the owner's limit (0 means none, no AI call)", async () => {
  const site = { starter_questions: ["a?", "b?", "c?"], max_suggestions: 0 } as unknown as Site;
  assert.deepEqual(await maybeSuggestions(site, "q", "a", false), []);
  assert.deepEqual(await maybeSuggestions({ ...site, max_suggestions: 2 } as Site, "q", "a", true), ["a?", "b?"]);
});

test("widget keeps follow-up chips only under the latest reply and a compact action row", () => {
  const w = readFileSync("widget/widget.js", "utf8");
  assert.match(w, /function clearSuggestions\(\)/);
  assert.match(w, /clearSuggestions\(\);\n\s+addBubble\("user"/, "chips go away once the visitor sends the next message");
  assert.match(w, /\.gc-fb button \{ width: 24px; height: 24px;/);
  const d = readFileSync("dashboard/index.html", "utf8");
  assert.match(d, /name="max_sources"/);
  assert.match(d, /name="max_suggestions"/);
});
