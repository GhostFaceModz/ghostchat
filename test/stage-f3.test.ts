import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contentHash, planIncremental } from "../server/src/lib/indexer.ts";
import { diffFromPlan, hideUrlsFromDiff, previewIsUnchanged } from "../server/src/lib/preview.ts";
import { isStagingKey, mergeRetrieval, newStagingKey } from "../server/src/lib/staging.ts";

const page = (url: string, text: string, title = url) => ({ url, title, text, status: 200 });

test("recrawl diff lists added, changed and removed pages", () => {
  const existing = [
    { id: "1", source_url: "https://x.com/a", content_hash: contentHash("same"), source_type: "crawl", filename: "A" },
    { id: "2", source_url: "https://x.com/b", content_hash: contentHash("old"), source_type: "crawl", filename: "B" },
    { id: "3", source_url: "https://x.com/c", content_hash: contentHash("gone"), source_type: "crawl", filename: "C" },
  ];
  const pages = [page("https://x.com/a", "same", "A"), page("https://x.com/b", "new b", "B"), page("https://x.com/d", "fresh", "D")];
  const plan = planIncremental(existing, pages, { removeMissing: true });
  const diff = diffFromPlan(plan, existing);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].url, "https://x.com/d");
  assert.equal(diff.updated.length, 1);
  assert.equal(diff.updated[0].documentId, "2");
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].documentId, "3");
  assert.equal(diff.unchanged, 1);
  assert.equal(previewIsUnchanged(diff), false);
  assert.deepEqual(hideUrlsFromDiff(diff).sort(), ["https://x.com/b", "https://x.com/c"].sort());
});

test("an unchanged recrawl does not need approval", () => {
  const existing = [{ id: "1", source_url: "https://x.com/a", content_hash: contentHash("same text"), source_type: "crawl", filename: "A" }];
  const plan = planIncremental(existing, [page("https://x.com/a", "same text", "A")], { removeMissing: true });
  const diff = diffFromPlan(plan, existing);
  assert.equal(previewIsUnchanged(diff), true);
  assert.deepEqual(hideUrlsFromDiff(diff), []);
});

test("staging retrieval hides removed pages and prefers unpublished chunks", () => {
  const live = [
    { id: "l1", site_id: "s", url: "https://x.com/old", title: "Old", content: "live old", similarity: 0.9 },
    { id: "l2", site_id: "s", url: "https://x.com/same", title: "Same", content: "live same", similarity: 0.8 },
    { id: "l3", site_id: "s", url: "https://x.com/keep", title: "Keep", content: "live keep", similarity: 0.5 },
  ];
  const staging = [
    { id: "s1", site_id: "s", url: "https://x.com/same", title: "Same", content: "staged same", similarity: 0.6 },
  ];
  const merged = mergeRetrieval(live, staging, ["https://x.com/old"]);
  assert.equal(merged.some((c) => c.id === "l1"), false);
  assert.equal(merged.some((c) => c.id === "l2"), false);
  assert.equal(merged.find((c) => c.url === "https://x.com/same")?.content, "staged same");
  assert.equal(merged.some((c) => c.id === "l3"), true);
});

test("staging keys are distinct from the public site key", () => {
  const key = newStagingKey();
  assert.equal(isStagingKey(key), true);
  assert.match(key, /^gc_stg_/);
  assert.equal(isStagingKey("gc_demo_ghostchat_pro"), false);
});

test("dashboard, widget and test page expose the unpublished training flow", () => {
  const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(dash, /preview-box/);
  assert.match(dash, /Add to the test widget first/);
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  assert.match(widget, /Test widget — unpublished training/);
  const page = readFileSync(new URL("../public/test-widget.html", import.meta.url), "utf8");
  assert.match(page, /gc_stg_/);
});
