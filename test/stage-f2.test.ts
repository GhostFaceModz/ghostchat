import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectSnippet, classifyInstall, clipPageUrl, pageMatchesSite } from "../server/src/lib/widgetHealth.ts";

const KEY = "gc_demo_ghostchat_pro";

test("detectSnippet finds widget.js plus the site key", () => {
  const html = `<html><body><script src="https://ghostchat.pro/widget.js?v=abc" data-id="${KEY}"></script></body></html>`;
  const d = detectSnippet(html, KEY);
  assert.equal(d.widgetScript, true);
  assert.equal(d.siteKey, true);
  assert.equal(d.found, true);
  assert.equal(detectSnippet("<html>no chat here</html>", KEY).found, false);
  assert.equal(detectSnippet(`<script src="/widget.js"></script>`, KEY).siteKey, false);
});

test("classifyInstall prefers a recent widget load over a homepage miss", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const active = classifyInstall({
    lastSeenAt: "2026-11-18T11:00:00Z",
    lastPage: "https://shop.example/help",
    siteUrl: "https://shop.example",
    snippet: { widgetScript: false, siteKey: false, found: false },
    fetched: true,
    now,
  });
  assert.equal(active.status, "active");
  const installed = classifyInstall({
    lastSeenAt: null, lastPage: null, siteUrl: "https://shop.example",
    snippet: { widgetScript: true, siteKey: true, found: true }, fetched: true, now,
  });
  assert.equal(installed.status, "installed");
  const missing = classifyInstall({
    lastSeenAt: null, lastPage: null, siteUrl: "https://shop.example",
    snippet: { widgetScript: false, siteKey: false, found: false }, fetched: true, now,
  });
  assert.equal(missing.status, "missing");
  const unknown = classifyInstall({
    lastSeenAt: null, lastPage: null, siteUrl: "https://shop.example",
    snippet: null, fetched: false, now,
  });
  assert.equal(unknown.status, "unknown");
});

test("page URL helpers reject non-http and match related hosts", () => {
  assert.equal(clipPageUrl("https://shop.example/help#top"), "https://shop.example/help");
  assert.equal(clipPageUrl("javascript:alert(1)"), null);
  assert.equal(pageMatchesSite("https://shop.example", "https://www.shop.example/a"), true);
  assert.equal(pageMatchesSite("https://shop.example", "https://evil.example/"), false);
});

test("widget sends the current page on config load and the dashboard can recheck", () => {
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  assert.match(widget, /\/api\/widget\/config\//);
  assert.match(widget, /page=/);
  const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(dash, /install-health/);
});
