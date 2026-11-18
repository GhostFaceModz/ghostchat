import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { purgeAt, RECYCLE_AFTER_MS } from "../server/src/lib/recycleBin.ts";

test("recycle bin keeps documents for 7 days", () => {
  const deleted = "2026-11-18T06:00:00.000Z";
  assert.equal(RECYCLE_AFTER_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(purgeAt(deleted), "2026-11-25T06:00:00.000Z");
});

test("dashboard and API wire a training recycle bin with restore", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20261118100000_ghostchat_document_recycle_bin.sql", import.meta.url), "utf8");
  assert.match(html, /recycle-box/);
  assert.match(js, /documents\/trash/);
  assert.match(js, /\/restore/);
  assert.match(routes, /softDeleteDocument/);
  assert.match(sql, /deleted_at/);
  assert.match(sql, /d\.deleted_at IS NOT NULL/);
});
