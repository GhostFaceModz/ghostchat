import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEMO_SITE_KEY } from "../server/src/lib/demoSite.ts";
import { GTE_MODEL } from "../server/src/lib/gteEmbeddings.ts";
import { resolveEmbeddingModel } from "../server/src/lib/models.ts";

const landing = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../public/guide.html", import.meta.url), "utf8");
const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const siteJs = readFileSync(new URL("../public/assets/site.js", import.meta.url), "utf8");
const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
const demo = readFileSync(new URL("../widget/index.html", import.meta.url), "utf8");

test("official demo site key is used on the landing page, guide, dashboard, and demo playground", () => {
  assert.equal(DEMO_SITE_KEY, "gc_demo_ghostchat_pro");
  for (const html of [landing, guide, dash, demo]) {
    assert.match(html, new RegExp(DEMO_SITE_KEY));
  }
  assert.match(landing, /id="try-demo"/);
  assert.match(siteJs, /GhostChat\.open/);
  assert.match(demo, /data-open", "true"/);
});

test("widget exposes GhostChat.open for the landing-page demo button", () => {
  assert.match(widget, /window\.GhostChat = /);
  assert.match(widget, /open: function \(\) \{ setOpen\(true\); \}/);
});

test("gte-small is the default embeddings provider and stays 384-d", () => {
  assert.equal(GTE_MODEL, "gte-small");
  process.env.EMBEDDING_PROVIDER = "gte-small";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_KEY = "";
  const resolved = resolveEmbeddingModel();
  assert.equal(resolved.provider, "local");
  delete process.env.EMBEDDING_PROVIDER;
});
