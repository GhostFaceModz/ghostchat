import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const dashCss = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");
const siteCss = readFileSync(new URL("../public/assets/site.css", import.meta.url), "utf8");
const testWidget = readFileSync(new URL("../public/test-widget.html", import.meta.url), "utf8");
const demo = readFileSync(new URL("../widget/index.html", import.meta.url), "utf8");
const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");

test("login art uses the unclipped mascot crop", () => {
  assert.ok(existsSync(new URL("../public/img/hero-mascot.webp", import.meta.url)));
  assert.ok(existsSync(new URL("../public/img/hero-mascot-sm.webp", import.meta.url)));
  assert.match(dash, /hero-mascot\.webp/);
  assert.doesNotMatch(dash, /auth-art-body[\s\S]{0,200}hero\.webp/);
});

test("legal links and marketing footers clear the demo widget badge", () => {
  assert.match(dashCss, /padding: 36px 20px calc\(96px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(siteCss, /body\.has-demo-widget \.footer \{ padding-bottom: calc\(112px \+ env\(safe-area-inset-bottom\)\)/);
});

test("test-widget empty state is calm and points to the dashboard", () => {
  assert.match(testWidget, /No test key in this link/);
  assert.match(testWidget, /gc_stg_/);
  assert.match(testWidget, /href=['"]\/dashboard['"]/);
  assert.doesNotMatch(testWidget, /class="warn"/);
});

test("demo playground does not auto-open the widget on small screens", () => {
  assert.match(demo, /gc_demo_ghostchat_pro/);
  assert.match(demo, /function isNarrow/);
  assert.match(demo, /loadWidget\(!isNarrow\(\)\)/);
  assert.match(demo, /demo-gutter/);
});

test("widget respects safe areas and uses a nearly full-screen panel on phones", () => {
  assert.match(widget, /safe-area-inset-bottom/);
  assert.match(widget, /@media \(max-width: 520px\) \{ \.gc-panel/);
  assert.match(widget, /prefers-reduced-motion: reduce/);
});
