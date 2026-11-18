import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const n = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * n(0) + 0.7152 * n(2) + 0.0722 * n(4);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test("light dashboard theme meets WCAG AA contrast on the page background", () => {
  const bg = "#f4f0ff";
  assert.ok(contrast("#1a1330", bg) >= 7, "body text should be AAA against the light background");
  assert.ok(contrast("#3e3954", bg) >= 4.5, "muted text should be AA");
  assert.ok(contrast("#4c2fb8", bg) >= 4.5, "links should be AA");
  assert.ok(contrast("#ffffff", "#5b3cc4") >= 4.5, "primary button label should be AA");
});

test("dashboard remembers the theme toggle and follows prefers-color-scheme by default", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/theme.js", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(html, /gc_dash_theme/);
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /dashboard\/theme\.js/);
  assert.match(css, /\[data-theme="light"\]/);
  assert.match(js, /gc_dash_theme/);
  assert.match(js, /prefers-color-scheme/);
  assert.match(i18n, /theme\.toLight/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
