import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const landing = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const siteCss = readFileSync(new URL("../public/assets/site.css", import.meta.url), "utf8");

test("landing typography and card hierarchy are tightened", () => {
  assert.match(siteCss, /h1, h2, h3, h4 \{/);
  assert.match(siteCss, /section-head h2/);
  assert.match(landing, /plan\.hot/);
  assert.match(landing, /\.feature p \{ font-size: 16px/);
});

test("pricing uses a clear yearly toggle and equivalent monthly rates, without invented social proof", () => {
  assert.match(landing, /role="radiogroup"/);
  assert.match(landing, /class="track"/);
  assert.match(landing, /id="bill-yr"/);
  assert.match(landing, /£7\.50 \/ month, billed yearly/);
  assert.match(landing, /£24\.17 \/ month, billed yearly/);
  assert.doesNotMatch(landing, /testimonial/i);
  assert.doesNotMatch(landing, /\b\d[\d,]+\s+(customers|users|businesses|companies)\b/i);
});

test("mobile sticky signup CTA leaves room for the demo widget badge", () => {
  assert.match(landing, /class="sticky-cta"/);
  assert.match(landing, /Create your bot — free/);
  assert.match(siteCss, /right: 80px/);
  assert.match(siteCss, /\.sticky-cta/);
});

test("marketing contrast and reduced-motion are in place", () => {
  assert.match(siteCss, /--muted: #c9c3dc;/);
  assert.match(siteCss, /--soft: #b4aec8;/);
  assert.match(siteCss, /prefers-reduced-motion: reduce/);
});
