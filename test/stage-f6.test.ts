import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shopifySnippet, SHOPIFY_SNIPPET } from "../server/src/lib/integrations.ts";

test("the WordPress plugin injects widget.js from a saved site key", () => {
  const php = readFileSync(new URL("../integrations/wordpress/ghostchat/ghostchat.php", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../integrations/wordpress/ghostchat/readme.txt", import.meta.url), "utf8");
  assert.match(php, /Plugin Name: GhostChat/);
  assert.match(php, /data-id=/);
  assert.match(php, /gc_\[A-Za-z0-9_-\]\+/);
  assert.match(php, /wp_footer/);
  assert.match(readme, /not listed on WordPress\.org/);
});

test("the Shopify snippet is a theme file, not an app-store listing", () => {
  const liquid = readFileSync(new URL("../integrations/shopify/snippets/ghostchat.liquid", import.meta.url), "utf8");
  assert.match(liquid, /render 'ghostchat'/);
  assert.match(liquid, /YOUR_SITE_KEY/);
  assert.match(liquid, /not a Shopify App Store listing/);
  assert.match(shopifySnippet("gc_demo_ghostchat_pro"), /data-id="gc_demo_ghostchat_pro"/);
  assert.equal(shopifySnippet("not-a-key").includes("YOUR_SITE_KEY"), true);
  assert.equal(shopifySnippet("gc_stg_secret").includes("YOUR_SITE_KEY"), true);
  assert.match(SHOPIFY_SNIPPET, /YOUR_SITE_KEY/);
});

test("the dashboard offers downloads and says the stores were not submitted", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(html, /ghostchat-wordpress\.zip/);
  assert.match(html, /not listed on the WordPress or Shopify app stores/);
  assert.match(html, /we will not submit them unless you ask/);
});
