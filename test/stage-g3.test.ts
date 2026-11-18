import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCoverageMap } from "../server/src/lib/coverageMap.ts";

test("coverage map reports unused training and visitor-page gaps", () => {
  const map = buildCoverageMap(
    [
      { source_url: "https://shop.example/pricing/", filename: "Pricing" },
      { source_url: "https://shop.example/about", filename: "About" },
      { source_url: null, filename: "pasted FAQ" },
    ],
    [
      { role: "user", page_url: "https://shop.example/returns" },
      { role: "assistant", sources: [{ url: "https://shop.example/pricing" }] },
      { role: "user", page_url: "https://shop.example/returns/" },
      { role: "assistant", sources: [{ url: "https://shop.example/pricing/#vat" }] },
    ],
  );
  assert.equal(map.trained, 2);
  assert.equal(map.cited, 1);
  assert.equal(map.coverage, 50);
  assert.equal(map.unused.length, 1);
  assert.match(map.unused[0].url, /about/);
  assert.equal(map.gaps.length, 1);
  assert.equal(map.gaps[0].questions, 2);
  assert.match(map.gaps[0].url, /returns/);
});

test("the train tab loads a coverage map", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  assert.match(html, /coverage-box/);
  assert.match(js, /\/coverage/);
  assert.match(routes, /siteCoverage/);
});
