import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizeGa4Id, sanitizePlausibleDomain } from "../server/src/lib/widgetAnalytics.ts";

test("Plausible domains and GA4 IDs are sanitised before the widget can use them", () => {
  assert.equal(sanitizePlausibleDomain("https://www.example.com/path"), "example.com");
  assert.equal(sanitizePlausibleDomain("Shop.Example.com"), "shop.example.com");
  assert.equal(sanitizePlausibleDomain(""), null);
  assert.equal(sanitizePlausibleDomain("nope"), null);
  assert.equal(sanitizePlausibleDomain("https://not a host"), null);
  assert.equal(sanitizeGa4Id("g-test1234"), "G-TEST1234");
  assert.equal(sanitizeGa4Id(""), null);
  assert.equal(sanitizeGa4Id("UA-123"), null);
  assert.equal(sanitizeGa4Id("G-AB"), null);
});

test("widget fires open, message, lead and handoff events when IDs are set", () => {
  const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/widget.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(widget, /function trackEvent/);
  assert.match(widget, /ghostchat_open/);
  assert.match(widget, /ghostchat_message_sent/);
  assert.match(widget, /ghostchat_lead_captured/);
  assert.match(widget, /ghostchat_handoff/);
  assert.match(widget, /plausible\.io\/api\/event/);
  assert.match(widget, /google-analytics\.com\/g\/collect/);
  assert.match(html, /name="plausible_domain"/);
  assert.match(html, /name="ga4_id"/);
  assert.match(routes, /plausibleDomain/);
  assert.match(i18n, /analytics\.plausible/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
