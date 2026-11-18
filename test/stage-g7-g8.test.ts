import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCannedReplies } from "../server/src/lib/cannedReplies.ts";

test("workspace canned replies are trimmed and capped", () => {
  assert.deepEqual(normalizeCannedReplies([{ title: " Refund ", text: "  We refund within 14 days. " }]), [{ title: "Refund", text: "We refund within 14 days." }]);
  assert.equal(normalizeCannedReplies([{ title: "x", text: "no" }]).length, 0);
  assert.equal(normalizeCannedReplies(Array.from({ length: 50 }, (_, i) => ({ title: "Tip " + i, text: "Text " + i }))).length, 40);
});

test("account and inbox expose canned replies and keyboard shortcuts", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const live = readFileSync(new URL("../dashboard/live.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/auth.ts", import.meta.url), "utf8");
  assert.match(html, /acct-canned-list/);
  assert.match(live, /inbox-canned/);
  assert.match(live, /j\/k move/);
  assert.match(live, /ev\.key === "t"/);
  assert.match(routes, /\/canned/);
});
