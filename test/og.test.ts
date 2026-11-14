import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { wrap, hexColor, plainText, render, botCardSvg, brandCardSvg } from "../server/src/lib/og.js";

const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test("text helpers: wrapping with a clean ellipsis, colours, emoji stripped", () => {
  assert.deepEqual(wrap("Chat with GhostFlix", 640, 64, 0.68, 2), ["Chat with", "GhostFlix"]);
  const long = wrap("one two three four five six seven eight nine ten eleven twelve", 300, 40, 0.68, 2);
  assert.equal(long.length, 2);
  assert.match(long[1], /\S…$/);
  assert.equal(hexColor("#abc"), "#aabbcc");
  assert.equal(hexColor("red"), "#8b5cf6");
  assert.equal(plainText("Boo! 👻 I'm the helper ❤️"), "Boo! I'm the helper");
});

test("per-bot card renders a 1200x630 PNG with the bot name escaped", () => {
  const svg = botCardSvg({ name: "Tom & Jerry's <Shop>", host: "shop.example", color: "#14b8a6", greeting: "Hi 👋 ask me anything" });
  assert.match(svg, /Tom &amp;/);
  assert.match(svg, /Jerry&#39;s/);
  assert.match(svg, /&lt;Shop&gt;/);
  assert.doesNotMatch(svg, /<Shop>/);
  assert.doesNotMatch(svg, /👋/);
  const png = render(svg, 1200);
  assert.deepEqual(pngSize(png), [1200, 630]);
  assert.ok(png.length < 600_000, "small enough for WhatsApp/Discord previews");
  assert.doesNotMatch(botCardSvg({ name: "X", host: "x.com", branding: false }), /Powered by GhostChat/);
});

test("static brand cards exist at the right sizes and under 300KB", () => {
  for (const [f, w, h] of [["public/og-image.png", 1200, 630], ["public/og-image-square.png", 1200, 1200]] as const) {
    assert.deepEqual(pngSize(readFileSync(f)), [w, h]);
    assert.ok(statSync(f).size < 300_000, `${f} under 300KB`);
  }
  assert.match(brandCardSvg("wide"), /Premium AI chat/);
  assert.match(brandCardSvg("square"), /Live human handoff/);
});

test("every public page has full preview tags and icons", () => {
  for (const f of ["index.html", "guide.html", "privacy.html", "terms.html"]) {
    const h = readFileSync(`public/${f}`, "utf8");
    for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image" content="https://ghostchat-nfoc.onrender.com/og-image.png"', 'og:image:width" content="1200"', 'og:image:height" content="630"', 'og:image:alt', 'property="og:url"', 'og:site_name', 'name="twitter:card" content="summary_large_image"', 'name="theme-color"', 'rel="apple-touch-icon"', 'rel="manifest"', 'href="/favicon.ico"'])
      assert.ok(h.includes(tag), `${f} has ${tag}`);
    assert.equal((h.match(/property="og:title"/g) || []).length, 1, `${f}: one og:title`);
  }
});
