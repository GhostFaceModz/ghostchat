import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkText, cleanText } from "../server/src/lib/chunk.ts";

test("chunks long text with overlap and skips tiny leftovers", () => {
  const para = "GhostChat answers questions from your own site. ".repeat(80);
  const chunks = chunkText(para + "\n\n" + para, { title: "Guide", url: "https://example.com/guide" });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].title, "Guide");
  assert.ok(chunks.every((c) => c.content.length >= 40));
});

test("cleanText collapses whitespace", () => {
  assert.equal(cleanText("Hello   \n\n\n  world"), "Hello\n\nworld");
});
