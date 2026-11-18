import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { questionFromGapUrl } from "../server/src/lib/faqDrafts.ts";

test("coverage gaps get a readable prefilled question from the page path", () => {
  assert.equal(questionFromGapUrl("https://shop.example/help/shipping-policy"), "What should visitors know about Shipping policy?");
  assert.equal(questionFromGapUrl("https://shop.example/returns.html"), "What should visitors know about Returns?");
  assert.equal(questionFromGapUrl("https://shop.example/"), "What should visitors know about this page?");
});

test("coverage map offers one-click train-this-gap drafts", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(html, /id="gap-dialog"/);
  assert.match(html, /id="gap-form"/);
  assert.match(js, /data-train-gap/);
  assert.match(js, /openTrainGap/);
  assert.match(js, /\/faq-drafts/);
  assert.match(routes, /createOwnerFaqDraft/);
  assert.match(routes, /sitesRouter\.post\("\/:id\/faq-drafts"/);
  assert.match(i18n, /gap.title/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
