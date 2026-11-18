import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");

test("dashboard contrast and controls match the marketing palette", () => {
  assert.match(css, /--muted: #c9c3dc;/);
  assert.match(css, /--soft: #b4aec8;/);
  assert.match(css, /\.btn \{[^}]*border-radius: 14px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /font-family: var\(--font-display\)/);
  assert.match(css, /font-family: var\(--font-ui\)/);
});

test("Train tab is split into named accordions and keeps existing hooks", () => {
  assert.match(css, /\.train-acc \{/);
  for (const label of [
    "Crawl site",
    "Test widget",
    "Add documents and FAQs",
    "Crawl scope \(optional\)",
    "Eval set",
    "Import FAQs from CSV",
    "Knowledge coverage",
    "Training sources",
    "Recently removed",
  ]) {
    assert.ok(dash.includes(`<summary>${label}</summary>`), label);
  }
  for (const id of [
    "crawl-btn",
    "preview-box",
    "staging-box",
    "upload-form",
    "notion-form",
    "crawl-scope",
    "eval-box",
    "faq-import-box",
    "coverage-box",
    "doc-list",
    "recycle-box",
  ]) {
    assert.match(dash, new RegExp(`id="${id}"`));
  }
});
