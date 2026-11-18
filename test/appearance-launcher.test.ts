import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FREE_LAUNCHER_ICONS, FREE_LAUNCHER_STYLES, sanitizeCustomIcon, sanitizeLauncher } from "../server/src/lib/launcher.ts";
import { DEFAULT_HEADER_SUBTITLE, DEFAULT_HEADER_TITLE, HEADER_SUBTITLE_PRESETS, HEADER_TITLE_PRESETS, sanitizeHeader } from "../server/src/lib/widgetHeader.ts";

test("free launchers are limited to 3 icons and 2 styles; paid get the full set", () => {
  assert.deepEqual([...FREE_LAUNCHER_ICONS], ["ghost", "chat", "question"]);
  assert.deepEqual([...FREE_LAUNCHER_STYLES], ["solid", "gradient"]);
  const free = sanitizeLauncher({ icon: "headset", style: "neon", size: "lg", side: "left", offset: 40, custom_icon: "data:image/png;base64,aaa" }, "free");
  assert.equal(free.icon, "ghost");
  assert.equal(free.style, "gradient");
  assert.equal(free.size, "md");
  assert.equal(free.side, "right");
  assert.equal(free.offset, 22);
  assert.equal(free.custom_icon, null);
  const pro = sanitizeLauncher({ icon: "headset", style: "neon", size: "lg", side: "left", offset: 40, label: "Help" }, "pro");
  assert.equal(pro.icon, "headset");
  assert.equal(pro.style, "neon");
  assert.equal(pro.size, "lg");
  assert.equal(pro.side, "left");
  assert.equal(pro.offset, 40);
  assert.equal(pro.label, "Help");
});

test("custom launcher icons are rejected unless they are a small data-URL image on a paid plan", () => {
  assert.equal(sanitizeCustomIcon("https://evil.example/x.png"), null);
  assert.equal(sanitizeCustomIcon("data:text/html;base64,PHNjcmlwdD4="), null);
  const ok = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(sanitizeCustomIcon(ok), ok);
  const free = sanitizeLauncher({ icon: "custom", custom_icon: ok }, "free");
  assert.equal(free.icon, "ghost");
  const biz = sanitizeLauncher({ icon: "custom", custom_icon: ok }, "business");
  assert.equal(biz.icon, "custom");
  assert.equal(biz.custom_icon, ok);
});

test("header title is fixed on Free, preset-only on Pro, and free-text on Business", () => {
  assert.ok(HEADER_TITLE_PRESETS.includes("GhostChat Support"));
  assert.ok(HEADER_SUBTITLE_PRESETS.includes("We reply instantly"));
  assert.deepEqual(sanitizeHeader({ title: "Sales Assistant", subtitle: "We reply instantly" }, "free"), { title: DEFAULT_HEADER_TITLE, subtitle: DEFAULT_HEADER_SUBTITLE });
  const pro = sanitizeHeader({ title: "Help Center", subtitle: "Support · Online" }, "pro");
  assert.deepEqual(pro, { title: "Help Center", subtitle: "Support · Online" });
  assert.equal(sanitizeHeader({ title: "Not a preset", subtitle: "nope" }, "pro").title, DEFAULT_HEADER_TITLE);
  const biz = sanitizeHeader({ title: "  <b>GhostFlix</b> help  ", subtitle: "We typically reply in a minute" }, "business");
  assert.equal(biz.title, "GhostFlix help");
  assert.equal(biz.subtitle, "We typically reply in a minute");
  assert.equal(sanitizeHeader(null, "business", "GhostFlix").title, "GhostFlix", "unset paid header keeps the site name");
  assert.equal(sanitizeHeader({ title: "x".repeat(80) }, "business").title.length, 40);
});

test("dashboard Appearance and the widget expose launcher and header customisation", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/widget.ts", import.meta.url), "utf8");
  assert.match(html, /id="appear-preview"/);
  assert.match(html, /id="launcher-icons"/);
  assert.match(html, /name="header_title_preset"/);
  assert.match(html, /id="header-title-custom"/);
  assert.match(app, /currentHeaderValues/);
  assert.match(app, /updateAppearancePreview/);
  assert.match(widget, /function applyLauncher/);
  assert.match(widget, /cfg.header/);
  assert.match(widget, /htHelpCenter/);
  assert.match(routes, /header: sanitizeHeader/);
  assert.equal((i18n.match(/"appearance.header":/g) || []).length, 8);
  assert.equal((i18n.match(/"appearance.launcher":/g) || []).length, 8);
  assert.equal((i18n.match(/"appearance.headerNoteBusiness":/g) || []).length, 8);
});
