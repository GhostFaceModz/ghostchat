import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the dashboard PWA manifest opens the inbox/dashboard as a standalone app", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/dashboard.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.display, "standalone");
  assert.ok((manifest.icons || []).some((i) => i.src === "/icon-192.png"));
});

test("the service worker is network-first and never caches API requests", () => {
  const sw = readFileSync(new URL("../public/dashboard-sw.js", import.meta.url), "utf8");
  assert.match(sw, /startsWith\("\/api\/"\)/);
  assert.match(sw, /if \(req\.method !== "GET"\) return/);
  assert.match(sw, /network-first|fetch\(req\)/i);
  assert.doesNotMatch(sw, /\/api\/.*cache\.put/i);
});

test("the dashboard offers Add to Home Screen and a mobile thread view", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const live = readFileSync(new URL("../dashboard/live.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");
  assert.match(html, /dashboard\.webmanifest/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /pwa-install/);
  assert.match(app, /dashboard-sw\.js/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /Add to Home Screen/);
  assert.match(live, /is-thread/);
  assert.match(live, /inbox-back/);
  assert.match(css, /display-mode: standalone/);
  assert.match(css, /safe-area-inset/);
});
