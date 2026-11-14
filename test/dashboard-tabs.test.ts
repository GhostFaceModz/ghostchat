import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");

const TABS = [
  "setup", "train", "tools", "persona", "appearance", "model",
  "convert", "transcripts", "analytics", "leads", "share", "live",
  "support", "tickets", "features"
];

test("dashboard lists every site tab, including Leads, Share and Live chat", () => {
  for (const tab of TABS) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, new RegExp(`data-panel="${tab}"`));
  }
});

test("desktop tabs wrap so they stay on-screen; phones keep a swipeable row", () => {
  const base = css.match(/^\.tabs\s*\{[^}]+\}/m);
  assert.ok(base, "base .tabs rule");
  assert.match(base[0], /overflow-x:\s*auto/);
  assert.match(base[0], /-webkit-overflow-scrolling:\s*touch/);
  const desktop = css.match(/@media\s*\(min-width:\s*861px\)\s*\{[\s\S]*?\}/);
  assert.ok(desktop, "desktop min-width 861px breakpoint");
  assert.match(desktop[0], /\.tabs\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(desktop[0], /\.tabs\s*\{[^}]*overflow:\s*visible/);
});

test("mouse wheel scrolls an overflowing tab row horizontally", () => {
  assert.match(js, /#tabs"\)\.addEventListener\("wheel"/);
  assert.match(js, /scrollWidth\s*<=\s*\w+\.clientWidth/);
  assert.match(js, /scrollLeft\s*\+=/);
});
