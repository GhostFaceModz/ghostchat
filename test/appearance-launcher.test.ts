import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FREE_LAUNCHER_ICONS, FREE_LAUNCHER_STYLES, defaultLauncher, sanitizeCustomIcon, sanitizeLauncher, usesV3Launcher, v3LauncherFile } from "../server/src/lib/launcher.ts";
import { DEFAULT_HEADER_SUBTITLE, DEFAULT_HEADER_TITLE, HEADER_SUBTITLE_PRESETS, HEADER_TITLE_PRESETS, sanitizeHeader } from "../server/src/lib/widgetHeader.ts";

test("free launchers stay limited; paid get the full set including v3", () => {
  assert.deepEqual([...FREE_LAUNCHER_ICONS], ["ghost", "chat", "question", "ghost-mark", "jewel-headset"]);
  assert.deepEqual([...FREE_LAUNCHER_STYLES], ["solid", "gradient", "jewel"]);
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
  assert.match(app, /V3_LAUNCHER_ICONS/);
  assert.match(app, /launcher\/v3\/previews/);
  assert.match(widget, /cfg.header/);
  assert.match(widget, /htHelpCenter/);
  assert.match(routes, /header: sanitizeHeader/);
  assert.equal((i18n.match(/"appearance.header":/g) || []).length, 8);
  assert.equal((i18n.match(/"appearance.launcher":/g) || []).length, 8);
  assert.equal((i18n.match(/"appearance.headerNoteBusiness":/g) || []).length, 8);
});

test("the live default launcher stays ghost + gradient for new and empty sites", () => {
  assert.deepEqual(defaultLauncher(), { icon: "ghost", style: "gradient", size: "md", side: "right", offset: 22, label: "Chat", custom_icon: null });
  const empty = sanitizeLauncher(undefined, "business");
  assert.equal(empty.icon, "ghost");
  assert.equal(empty.style, "gradient");
  const existingGlass = sanitizeLauncher({ icon: "chat", style: "glass" }, "pro");
  assert.equal(existingGlass.icon, "chat");
  assert.equal(existingGlass.style, "glass", "classic glass is unchanged and not remapped to glass-shine");
});

test("v3 jewel icons are allowed on Free; animated shine styles are paid-only", () => {
  const mark = sanitizeLauncher({ icon: "ghost-mark", style: "jewel" }, "free");
  assert.equal(mark.icon, "ghost-mark");
  assert.equal(mark.style, "jewel");
  const headset = sanitizeLauncher({ icon: "jewel-headset", style: "jewel" }, "free");
  assert.equal(headset.icon, "jewel-headset");
  const blockedIcon = sanitizeLauncher({ icon: "chat-typing", style: "jewel" }, "free");
  assert.equal(blockedIcon.icon, "ghost");
  const blockedStyle = sanitizeLauncher({ icon: "ghost-mark", style: "gradient-shine" }, "free");
  assert.equal(blockedStyle.style, "gradient");
  const pro = sanitizeLauncher({ icon: "message-check", style: "pill-support" }, "pro");
  assert.equal(pro.icon, "message-check");
  assert.equal(pro.style, "pill-support");
  assert.equal(v3LauncherFile("ghost-mark", "gradient-shine"), "ghost-mark--gradient-shine.svg");
  assert.equal(v3LauncherFile("ghost", "jewel"), "ghost-mark--jewel.svg");
  assert.equal(usesV3Launcher("ghost", "gradient"), false);
  assert.equal(usesV3Launcher("ghost-mark", "gradient"), true);
});

test("v3 launcher assets exist, stay out of widget.js, and respect reduced motion", () => {
  const dir = new URL("../public/launcher/v3/", import.meta.url);
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  assert.match(widget, /function v3LauncherFile/);
  assert.match(widget, /\/launcher\/v3\//);
  assert.doesNotMatch(widget, /05ghostmarkcore/);
  assert.ok(widget.length < 180_000, "widget.js should stay small and lazy-load the selected SVG");
  const needed = ["ghost-mark--jewel.svg", "jewel-headset--jewel.svg", "ghost-headset--gradient-shine.svg", "chat-typing--glass-shine.svg", "sparkle-chat--outline-glow.svg", "message-check--pill-support.svg"];
  for (const name of needed) {
    const svg = readFileSync(new URL(name, dir), "utf8");
    assert.match(svg, /prefers-reduced-motion/);
    assert.match(svg, /@keyframes breathe/);
    assert.match(svg, /@keyframes shineSweep/);
  }
});
