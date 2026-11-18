import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guide = readFileSync(new URL("../public/guide.html", import.meta.url), "utf8");

test("setup guide documents eval, coverage, recycle, FAQ CSV, Slack and the command palette", () => {
  assert.match(guide, /id="power"/);
  assert.match(guide, /Eval set/);
  assert.match(guide, /Knowledge coverage/);
  assert.match(guide, /Recently removed/);
  assert.match(guide, /FAQ CSV/);
  assert.match(guide, /Canned replies/);
  assert.match(guide, /Agent credit caps/);
  assert.match(guide, /Slack incoming webhook/);
  assert.match(guide, /Ctrl<\/kbd>\+<kbd>K/);
  assert.match(guide, /test widget first/);
  assert.match(guide, /two months free/);
});
