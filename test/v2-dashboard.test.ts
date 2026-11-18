import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const v2 = readFileSync(new URL("../dashboard/v2.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
const guide = readFileSync(new URL("../public/guide.html", import.meta.url), "utf8");

test("v2 dashboard script parses and is loaded after app.js", () => {
  new vm.Script(v2);
  assert.ok(html.indexOf("/dashboard/v2.js") > html.indexOf("/dashboard/app.js"));
  assert.match(app, /window\.gcSiteChanged\(\)/);
});

test("mode picker covers the four bot modes and support settings save to the API", () => {
  for (const m of ["assistant", "support", "sales", "recommendations"]) assert.match(v2, new RegExp(`\\["${m}"`));
  assert.match(v2, /support: \{/);
  assert.match(html, /name="out_of_hours_message"/);
  assert.match(html, /id="canned-list"/);
});

test("tickets view: filter, reply, solve, canned insert, mailto", () => {
  assert.match(html, /data-status="pending"/);
  assert.match(v2, /\/tickets\/\$\{id\}\/reply/);
  assert.match(v2, /status: solve \? "solved" : "pending"/);
  assert.match(v2, /data-canned/);
  assert.match(v2, /mailto:/);
});

test("smart features form covers lookup, language, memory, recrawl, greetings, forms, domain, channels", () => {
  for (const n of ["live_lookup", "lookup_search_url", "multilingual", "memory_enabled", "recrawl_schedule", "form_enabled", "custom_domain", "wa_enabled", "ig_enabled"]) assert.match(html, new RegExp(`name="${n}"`));
  assert.match(v2, /ghostchat-nfoc\.onrender\.com/);
  assert.match(guide, /id="meta"/);
});

test("onboarding wizard has five steps: site, crawl, style, snippet, test chat", () => {
  for (let i = 1; i <= 5; i++) assert.match(html, new RegExp(`data-step="${i}"`));
  assert.match(v2, /\/crawl", \{ method: "POST" \}/);
  assert.match(html, /id="wz-chat"/);
  assert.match(html, /id="wz-faq"/);
  assert.match(v2, /Train on this FAQ|\/documents", \{ method: "POST"/);
  for (const plat of ["Shopify", "Wix", "Squarespace", "WordPress", "Webflow"]) assert.match(html, new RegExp(plat));
  assert.match(v2, /Online Store → Themes → Edit code/);
  assert.match(v2, /Custom Code → Add Code/);
  assert.match(v2, /Code Injection/);
  assert.match(v2, /footer.php/);
  assert.match(v2, /Footer Code/);
});

test("dashboard and wizard embed snippets use https://ghostchat.pro, CNAME target stays on Render", () => {
  assert.match(app, /https:\/\/ghostchat\.pro/);
  assert.match(app, /GHOSTCHAT_PUBLIC_ORIGIN/);
  assert.match(v2, /GHOSTCHAT_PUBLIC_ORIGIN \|\| "https:\/\/ghostchat\.pro"/);
  assert.match(v2, /ghostchat-nfoc\.onrender\.com/);
  assert.match(guide, /chat<\/code> → <code>ghostchat-nfoc\.onrender\.com<\/code>/);
  assert.match(guide, /https:\/\/ghostchat\.pro\/widget\.js/);
  assert.match(guide, /https:\/\/ghostchat\.pro\/api\/webhooks\/meta/);
});
