import { test } from "node:test";
import assert from "node:assert/strict";
import { localEmbed } from "../server/src/lib/localEmbeddings.js";
import { similarityThreshold } from "../server/src/lib/chat.js";

const cos = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0) / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));

test("local hash embeddings: a matching FAQ clears the retrieval threshold, unrelated text does not", async () => {
  process.env.EMBEDDING_PROVIDER = "local";
  delete process.env.SIMILARITY_THRESHOLD;
  const doc = "Q: What are your opening hours? A: Ghost Bakery is open Monday to Saturday from 8am to 6pm, and closed on Sundays.";
  const [d, hit, miss] = await localEmbed([doc, "When are you open on Saturday?", "Tell me about pricing plans"]);
  const t = similarityThreshold();
  assert.ok(cos(d, hit) > t, `expected match above ${t}`);
  assert.ok(cos(d, miss) < t, `expected unrelated text below ${t}`);
});

test("SIMILARITY_THRESHOLD env overrides the default", () => {
  process.env.SIMILARITY_THRESHOLD = "0.5";
  assert.equal(similarityThreshold(), 0.5);
  delete process.env.SIMILARITY_THRESHOLD;
});
