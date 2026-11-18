import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseExpect, scoreExpect } from "../server/src/lib/evalSet.ts";

test("eval phrases are split and all must appear in the sources", () => {
  assert.deepEqual(parseExpect("£9, VAT\nPro plan"), ["£9", "VAT", "Pro plan"]);
  const ok = scoreExpect("GhostChat Pro is £9 per month plus VAT.", ["£9", "VAT"]);
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.matched, ["£9", "VAT"]);
  const miss = scoreExpect("We have a free plan.", ["£9", "VAT"]);
  assert.equal(miss.pass, false);
  assert.deepEqual(miss.missing, ["£9", "VAT"]);
  const emptyFail = scoreExpect("  ", []);
  assert.equal(emptyFail.pass, false);
  const emptyPass = scoreExpect("A reasonably long retrieved passage about the product.", []);
  assert.equal(emptyPass.pass, true);
});

test("the train tab has an eval set that runs without calling the chat model", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../server/src/lib/evalSet.ts", import.meta.url), "utf8");
  assert.match(html, /eval-box/);
  assert.match(html, /does not call the chat model or use credits/);
  assert.match(js, /\/api\/sites\/" \+ state\.site\.id \+ "\/eval\/run/);
  assert.match(routes, /eval\/run/);
  assert.doesNotMatch(lib, /answerQuestion|completeChat/);
});
