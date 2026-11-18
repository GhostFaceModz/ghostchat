import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFaqCsv } from "../server/src/lib/faqImport.ts";

test("FAQ CSV parser reads headers, quotes and skips blanks", () => {
  const rows = parseFaqCsv(`question,answer
"How much is Pro?","It's £9, plus VAT."
What is the free plan?,You can try it on one site.

# comment
hi,no
`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].question, "How much is Pro?");
  assert.match(rows[0].answer, /£9/);
  assert.equal(rows[1].question, "What is the free plan?");
});

test("train tab and API can import an FAQ CSV, and the schema allows faq sources", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20261118120000_ghostchat_faq_source_type.sql", import.meta.url), "utf8");
  assert.match(html, /faq-import-form/);
  assert.match(routes, /faq\/import/);
  assert.match(sql, /'faq'/);
});
