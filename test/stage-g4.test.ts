import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isTrivialRedirect, resolveRedirect, issueFromOutcome, urlKey, type FetchPageOutcome } from "../server/src/lib/crawl.ts";
import { attachCrawlIssues, previewIsUnchanged, type PreviewDiff } from "../server/src/lib/preview.ts";

test("redirect helpers keep slash-only and http-to-https moves trivial", () => {
  const from = new URL("https://shop.example/old");
  const next = resolveRedirect(from, "/new");
  assert.equal(next?.href, "https://shop.example/new");
  assert.equal(urlKey("https://shop.example/pricing/"), urlKey("http://shop.example/pricing"));
  assert.equal(isTrivialRedirect("http://shop.example/pricing/", "https://shop.example/pricing"), true);
  assert.equal(isTrivialRedirect("https://shop.example/a", "https://shop.example/b"), false);
});

test("fetch outcomes become broken-link or redirect issues", () => {
  const fail: FetchPageOutcome = { ok: false, status: 404, url: "https://shop.example/gone", finalUrl: "https://shop.example/gone", reason: "http" };
  const broken = issueFromOutcome(new URL("https://shop.example/gone"), fail);
  assert.equal(broken?.status, 404);
  assert.equal(broken?.reason, "http");
  const ok: FetchPageOutcome = { ok: true, html: "<html></html>", finalUrl: new URL("https://shop.example/new"), status: 200, redirectedFrom: "https://shop.example/old" };
  assert.equal(issueFromOutcome(new URL("https://shop.example/old"), ok)?.reason, "redirect");
  const trivial: FetchPageOutcome = { ok: true, html: "<html></html>", finalUrl: new URL("https://shop.example/pricing"), status: 200, redirectedFrom: "http://shop.example/pricing/" };
  assert.equal(issueFromOutcome(new URL("http://shop.example/pricing/"), trivial), null);
});

test("preview diffs can list broken links without counting as a content change", () => {
  const diff: PreviewDiff = { added: [], updated: [], removed: [], unchanged: 4, pages: 4 };
  const withIssues = attachCrawlIssues(diff, [
    { url: "https://shop.example/gone", status: 404, reason: "http" },
    { url: "https://shop.example/old", status: 301, finalUrl: "https://shop.example/new", reason: "redirect" },
  ]);
  assert.equal(previewIsUnchanged(withIssues), true);
  assert.equal(withIssues.broken?.length, 1);
  assert.equal(withIssues.redirects?.length, 1);
});

test("recrawl preview UI renders broken links and redirects", () => {
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  assert.match(js, /previewIssuesHtml/);
  assert.match(js, /Broken links/);
  assert.match(routes, /issues: result\.issues/);
});
