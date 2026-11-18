import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_AI_DISCLOSURE, effectiveDisclosure, sanitizeDisclosure } from "../server/src/lib/usage.ts";

test("AI disclosure is editable and free plans cannot hide it", () => {
  assert.equal(DEFAULT_AI_DISCLOSURE, "This chat uses AI.");
  assert.equal(effectiveDisclosure({ plan: "free", ai_disclosure: "This chat uses AI." }), "This chat uses AI.");
  assert.equal(effectiveDisclosure({ plan: "free", ai_disclosure: "  Answers are written by AI.  " }), "Answers are written by AI.");
  assert.equal(effectiveDisclosure({ plan: "free", ai_disclosure: "   " }), "This chat uses AI.", "free cannot hide");
  assert.equal(effectiveDisclosure({ plan: "pro", ai_disclosure: "" }), "", "paid can hide");
  assert.equal(effectiveDisclosure({ plan: "business", ai_disclosure: "Powered by our AI helper" }), "Powered by our AI helper");
  assert.equal(sanitizeDisclosure("", "free"), "This chat uses AI.");
  assert.equal(sanitizeDisclosure("", "pro"), "");
  assert.equal(sanitizeDisclosure("x".repeat(200), "free").length, 120);
});

test("widget and dashboard expose the AI disclosure setting", () => {
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/widget.ts", import.meta.url), "utf8");
  const sites = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(widget, /gc-disclose/);
  assert.match(widget, /aiDisclosure/);
  assert.match(html, /name="ai_disclosure"/);
  assert.match(routes, /aiDisclosure: effectiveDisclosure/);
  assert.match(sites, /sanitizeDisclosure/);
  assert.match(i18n, /appearance\.disclosure/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
