import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { csvEscape, exportFilename, knowledgeExportToCsv, type KnowledgeExport } from "../server/src/lib/knowledgeExport.ts";

const sample: KnowledgeExport = {
  exported_at: "2026-11-18T08:00:00.000Z",
  site: { id: "site-1", name: "Acme Shop", url: "https://acme.example" },
  faqs: [{ id: "f1", question: "How do I return an item?", answer: "Within 30 days, prepaid label.", source_url: "https://acme.example/returns", created_at: "2026-11-01T00:00:00.000Z" }],
  teach_answers: [{ id: "t1", question: "Do you ship to Ireland?", answer: "Yes, 3–5 days.", created_at: "2026-11-02T00:00:00.000Z" }],
  canned_replies: [{ title: "Refund policy", text: "Refunds take 5–7 days, see /returns.", scope: "workspace" }],
  crawled_sources: [{ id: "c1", title: "Shipping", url: "https://acme.example/shipping", chunk_count: 3, created_at: "2026-10-01T00:00:00.000Z" }],
};

test("knowledge export CSV includes FAQs, teach answers, canned replies and crawled sources", () => {
  assert.equal(csvEscape('He said "hi", then left'), '"He said ""hi"", then left"');
  const csv = knowledgeExportToCsv(sample);
  assert.match(csv, /^type,title,body,url,created_at,scope\n/);
  assert.match(csv, /faq,How do I return an item\?,"Within 30 days, prepaid label\.",https:\/\/acme\.example\/returns/);
  assert.match(csv, /teach,Do you ship to Ireland\?,"Yes, 3–5 days\."/);
  assert.match(csv, /canned,Refund policy,"Refunds take 5–7 days, see \/returns\.",,,workspace/);
  assert.match(csv, /crawl,Shipping,,https:\/\/acme\.example\/shipping/);
  assert.match(exportFilename({ name: "Acme Shop!" }, "json"), /^ghostchat-knowledge-acme-shop-\d{4}-\d{2}-\d{2}\.json$/);
});

test("knowledge export is wired into the Train tab and the sites API", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(html, /id="export-json"/);
  assert.match(html, /id="export-csv"/);
  assert.match(js, /knowledge-export/);
  assert.match(routes, /buildKnowledgeExport/);
  assert.match(routes, /knowledge-export/);
  assert.match(i18n, /export\.title/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
