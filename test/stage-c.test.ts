import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { rewriteQuery, looksLikeFollowUp } from "../server/src/lib/queryRewrite.ts";
import { extractJsonLd, productsToPages, JS_RENDER_SKIPPED } from "../server/src/lib/structuredData.ts";
import { faqCandidatesFromPages } from "../server/src/lib/faqDrafts.ts";
import { extractText, JS_RENDER_SKIPPED as CRAWL_JS_SKIP } from "../server/src/lib/crawl.ts";
import { extractDocxText, extractRtfText } from "../server/src/lib/documents.ts";
import { chunkText } from "../server/src/lib/chunk.ts";
import { labelGeneralKnowledge, GENERAL_KNOWLEDGE_LABEL, buildSystemPrompt, answerMode } from "../server/src/lib/chat.ts";
import { config, PLAN_LIMITS } from "../server/src/config.ts";
import type { Site } from "../server/src/types.ts";

const site = (mode: "helpful" | "strict"): Site =>
  ({
    id: "s1",
    name: "GhostChat",
    url: "https://ghostchat.pro",
    answer_mode: mode,
    plan: "free",
  }) as Site;

test("query rewrite turns a short follow-up into a standalone search", () => {
  assert.equal(looksLikeFollowUp("and the Pro plan?"), true);
  const rewritten = rewriteQuery("and the Pro plan?", [
    { role: "user", content: "How much does GhostChat cost?" },
    { role: "assistant", content: "The Starter plan is free." },
    { role: "user", content: "and the Pro plan?" },
  ]);
  assert.match(rewritten, /How much does GhostChat cost/);
  assert.match(rewritten, /Pro plan/);
  assert.equal(rewriteQuery("What are your opening hours?", []), "What are your opening hours?");
});

test("JSON-LD products become crawlable pages with price and stock", () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Starter hoodie","url":"https://shop.example/products/hoodie","offers":{"@type":"Offer","price":"29.00","priceCurrency":"GBP","availability":"https://schema.org/InStock"}}</script></head><body><h1>Shop</h1></body></html>`;
  const { products, faqs } = extractJsonLd(html, "https://shop.example/shop");
  assert.equal(products.length, 1);
  assert.equal(products[0].title, "Starter hoodie");
  assert.match(String(products[0].price), /29/);
  assert.match(String(products[0].availability), /instock/i);
  const pages = productsToPages(products, "https://shop.example");
  assert.equal(pages[0].url, "https://shop.example/products/hoodie");
  assert.match(pages[0].text, /29/);
  assert.match(pages[0].text, /in stock/i);
  assert.deepEqual(faqs, []);
});

test("FAQ drafts are suggested from Q/A lines and question headings", () => {
  const pages = [
    {
      url: "https://ghostchat.pro/",
      title: "GhostChat",
      text: "What does the Pro plan include?\nLive chat, more pages, and custom branding on the widget.\n\nQ: Can I paste an FAQ?\nA: Yes — paste it in the wizard if the crawl finds nothing.",
    },
  ];
  const drafts = faqCandidatesFromPages(pages);
  assert.ok(drafts.length >= 2, JSON.stringify(drafts));
  assert.ok(drafts.some((d) => /Pro plan/i.test(d.question) && /Live chat/i.test(d.answer)));
  assert.ok(drafts.some((d) => /paste an FAQ/i.test(d.question) && /wizard/i.test(d.answer)));
});

test("extractText keeps heading sections and does not drop JSON-LD scripts early", () => {
  const html = `<html><head><title>Guide</title></head><body>
    <h1>Guide</h1><p>GhostChat is an on-site assistant for your own website content and visitors.</p>
    <h2>Pricing</h2><p>The Pro plan is fifteen pounds a month and includes live chat handoff.</p>
    <a href="/pricing">Pricing</a><a href="/guide.pdf">PDF</a>
  </body></html>`;
  const { title, sections, links, text } = extractText(html, "https://ghostchat.pro/guide");
  assert.equal(title, "Guide");
  assert.ok(sections.some((s) => s.heading === "Pricing" && /fifteen pounds/i.test(s.text)));
  assert.ok(links.includes("/guide.pdf"));
  assert.match(text, /Pricing/);
});

test("chunks store the page title and heading in the text", () => {
  const chunks = chunkText("The Pro plan includes live chat and custom branding on the widget.", {
    title: "Pricing",
    url: "https://ghostchat.pro/pricing",
    heading: "Pro plan",
  });
  assert.equal(chunks[0].heading, "Pro plan");
  assert.match(chunks[0].content, /^Pricing — Pro plan/);
});

test("helpful mode labels general-knowledge answers; strict stays on-site only", () => {
  assert.equal(answerMode(site("helpful")), "helpful");
  const chunks = [{ id: "c1", site_id: "s1", url: "https://ghostchat.pro/pricing", title: "Pricing", content: "The Pro plan costs fifteen pounds monthly and includes live chat handoff plus custom branding on the widget.", similarity: 0.9 }];
  const labelled = labelGeneralKnowledge(site("helpful"), "Paris is the capital of France.", chunks, false);
  assert.ok(labelled.startsWith(GENERAL_KNOWLEDGE_LABEL));
  assert.match(labelled, /Paris/);
  const grounded = labelGeneralKnowledge(site("helpful"), "The Pro plan costs fifteen pounds monthly and includes live chat handoff plus custom branding on the widget.", chunks, false);
  assert.equal(grounded.startsWith(GENERAL_KNOWLEDGE_LABEL), false);
  const greeting = labelGeneralKnowledge(site("helpful"), "Hi — I can help with pricing and the setup guide.", [], false);
  assert.equal(greeting.startsWith(GENERAL_KNOWLEDGE_LABEL), false);
  const strict = labelGeneralKnowledge(site("strict"), "Paris is the capital of France.", [], false);
  assert.equal(strict, "Paris is the capital of France.");
  const prompt = buildSystemPrompt(site("helpful"), chunks);
  assert.match(prompt, /General knowledge \(not from this site\):/);
  assert.match(buildSystemPrompt(site("strict"), chunks), /Answer ONLY using the CONTEXT/);
});

test("JS rendering is skipped on free RAM and the cost is documented", () => {
  assert.equal(CRAWL_JS_SKIP, JS_RENDER_SKIPPED);
  assert.match(JS_RENDER_SKIPPED, /\$25\/month/i);
  assert.match(JS_RENDER_SKIPPED, /Browserless|browser/i);
});

test("plan page caps are 30 / 150 / 400 and the crawl default can use them", () => {
  assert.equal(PLAN_LIMITS.free.maxPages, 30);
  assert.equal(PLAN_LIMITS.pro.maxPages, 150);
  assert.equal(PLAN_LIMITS.business.maxPages, 400);
  assert.equal(config.crawlMaxPages, 400);
  assert.equal(config.crawlMaxDepth, 8);
});

test("linked docx and rtf text can be extracted without a paid converter", () => {
  const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Returns are accepted within 30 days.</w:t></w:r></w:p></w:body></w:document>';
  const name = Buffer.from("word/document.xml");
  const payload = Buffer.from(xml, "utf8");
  const comp = deflateRawSync(payload);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(comp.length, 18);
  header.writeUInt32LE(payload.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  const docx = Buffer.concat([header, name, comp]);
  assert.match(extractDocxText(docx), /Returns are accepted within 30 days/);
  assert.match(extractRtfText(Buffer.from(String.raw`{\rtf1 Hello \par world}`)), /Hello/);
});

test("dashboard wires the unanswered teach form and FAQ draft review", () => {
  const html = readFileSync("dashboard/index.html", "utf8");
  const js = readFileSync("dashboard/app.js", "utf8");
  assert.match(html, /labelled general knowledge/);
  assert.match(html, /no general knowledge/);
  assert.match(js, /faq-drafts/);
  assert.match(js, /teach-form/);
  assert.match(js, /Unanswered questions/);
  assert.match(js, /Save as a source/);
});
