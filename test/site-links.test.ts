import { test } from "node:test";
import assert from "node:assert/strict";
import { siteHostsFrom, openSiteLinksMode } from "../server/src/lib/siteLinks.js";

test("siteHostsFrom includes apex and www for the site url and custom domain", () => {
  assert.deepEqual(siteHostsFrom("https://ghostflix.uk/", null).sort(), ["ghostflix.uk", "www.ghostflix.uk"]);
  const both = siteHostsFrom("https://www.ghostflix.uk", "ghostflix.uk");
  assert.ok(both.includes("ghostflix.uk") && both.includes("www.ghostflix.uk"));
  assert.equal(openSiteLinksMode(undefined), "same_tab");
  assert.equal(openSiteLinksMode("new_tab"), "new_tab");
});
