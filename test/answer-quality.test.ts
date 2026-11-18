import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjustedScore,
  isBroadQuestion,
  isHomeUrl,
  isLegalQuestion,
  isLegalUrl,
  isPricingQuestion,
  isSetupQuestion,
  rerankChunks,
} from "../server/src/lib/retrievalRerank.ts";
import { buildSystemPrompt, isUnsureAnswer, preferUsefulAnswer } from "../server/src/lib/chat.ts";
import { GHOSTCHAT_PACK_SECTIONS, ghostchatKnowledgePackText, packChunks } from "../server/src/lib/ghostchatKnowledgePack.ts";
import { GHOSTCHAT_EVAL_QUESTIONS } from "../server/src/lib/ghostchatEvalSet.ts";
import type { RetrievedChunk } from "../server/src/types.ts";

const chunk = (over: Partial<RetrievedChunk> & { id: string; content: string; url: string; similarity: number }): RetrievedChunk => ({
  site_id: "s1",
  title: over.title ?? "GhostChat",
  heading: over.heading ?? null,
  ...over,
});

test("classifies broad, pricing, setup and legal questions", () => {
  assert.equal(isBroadQuestion("What can ghostchat do"), true);
  assert.equal(isBroadQuestion("what can it do?"), true);
  assert.equal(isBroadQuestion("Tell me about this product"), true);
  assert.equal(isBroadQuestion("How much does GhostChat cost?"), false);
  assert.equal(isPricingQuestion("How much does GhostChat cost?"), true);
  assert.equal(isPricingQuestion("is there a yearly discount?"), true);
  assert.equal(isSetupQuestion("How do I add the widget to my site?"), true);
  assert.equal(isLegalQuestion("What is in your privacy policy?"), true);
  assert.equal(isLegalQuestion("What can ghostchat do"), false);
  assert.equal(isLegalUrl("https://ghostchat.pro/terms"), true);
  assert.equal(isLegalUrl("https://ghostchat.pro/privacy"), true);
  assert.equal(isHomeUrl("https://ghostchat.pro/"), true);
  assert.equal(isHomeUrl("https://ghostchat.pro/terms"), false);
});

test("rerank drops legal pages and keeps homepage overview for broad questions", () => {
  const terms = chunk({
    id: "t",
    url: "https://ghostchat.pro/terms",
    title: "Terms",
    content: "Plain-English rules for using GhostChat. The service lets you build an AI assistant.",
    similarity: 0.92,
  });
  const privacy = chunk({
    id: "p",
    url: "https://ghostchat.pro/privacy",
    title: "Privacy",
    content: "GhostChat privacy policy describes how we store visitor messages.",
    similarity: 0.91,
  });
  const overview = chunk({
    id: "h",
    url: "https://ghostchat.pro/",
    title: "GhostChat",
    heading: "What you can build",
    content: "GhostChat is a premium AI assistant that learns your pages, docs and FAQs, then answers visitors in your brand's voice, shows its sources, and turns conversations into leads.",
    similarity: 0.87,
  });
  const ranked = rerankChunks("What can ghostchat do", [terms, privacy, overview], { overview: [overview], keep: 4 });
  assert.equal(ranked[0].id, "h", `expected overview first, got ${ranked.map((c) => c.id + ":" + c.url).join(",")}`);
  assert.ok(ranked.some((c) => c.id === "h"));
  assert.ok(adjustedScore("What can ghostchat do", overview) > adjustedScore("What can ghostchat do", terms));
});

test("rerank boosts pricing chunks for cost questions even when legal scores higher", () => {
  const terms = chunk({
    id: "t",
    url: "https://ghostchat.pro/terms",
    title: "Terms",
    content: "Plans and billing. The Free plan has usage limits. Paid plans are billed through Whop.",
    similarity: 0.90,
  });
  const pricing = chunk({
    id: "pr",
    url: "https://ghostchat.pro/",
    title: "Plans",
    heading: "Plans",
    content: "Pro £9 / month + VAT. Business £29 / month + VAT. Yearly is two months free: Pro is £90 / year.",
    similarity: 0.76,
  });
  const ranked = rerankChunks("How much does GhostChat cost?", [terms, pricing], { keep: 3 });
  assert.equal(ranked[0].id, "pr", `expected pricing first, got ${ranked.map((c) => c.id).join(",")}`);
});

test("helpful prompt tells the model to answer from partial context and not refuse early", () => {
  const p = buildSystemPrompt(
    { name: "GhostChat", url: "https://ghostchat.pro", plan: "free", show_branding: true, answer_mode: "helpful" } as never,
    [],
  );
  assert.match(p, /even partly/);
  assert.match(p, /genuinely unrelated/);
  assert.match(p, /Do not lead with "I'm not sure"/);
  assert.match(p, /powered by GhostChat/);
  assert.doesNotMatch(p, /reply with exactly this sentence first/);
});

test("isUnsureAnswer treats a mixed 'I'm not sure' plus useful facts as an answer", () => {
  assert.equal(isUnsureAnswer("I'm not sure — I couldn't find that on this site."), true);
  assert.equal(isUnsureAnswer("I'm not sure — I couldn't find that on this site, so I'd rather not guess. Try asking another way, or ask me something else."), true);
  const mixed = "I'm not sure — I couldn't find that on this site. The Pro plan costs £9 per month plus VAT and includes 5,000 messages, 10 sites and live human handoff.";
  assert.equal(isUnsureAnswer(mixed), false);
  assert.match(preferUsefulAnswer(mixed), /Pro plan costs £9/);
  assert.doesNotMatch(preferUsefulAnswer(mixed), /I'm not sure/);
  assert.equal(preferUsefulAnswer("We open at 8am."), "We open at 8am.");
});

test("built-in GhostChat knowledge pack covers features, plans, yearly prices, setup and limits", () => {
  const text = ghostchatKnowledgePackText();
  for (const needle of [
    "What can GhostChat do",
    "£9",
    "£90",
    "£29",
    "£290",
    "two months free",
    "200 messages",
    "widget.js",
    "Shopify",
    "WhatsApp",
    "£5 for 1,000",
  ]) {
    assert.match(text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const chunks = packChunks();
  assert.ok(chunks.length >= GHOSTCHAT_PACK_SECTIONS.length);
  assert.ok(chunks.every((c) => (c.content || "").length >= 40));
});

test("official eval set has around 30 questions across the main topics", () => {
  assert.ok(GHOSTCHAT_EVAL_QUESTIONS.length >= 30 && GHOSTCHAT_EVAL_QUESTIONS.length <= 40);
  const qs = GHOSTCHAT_EVAL_QUESTIONS.map((q) => q.question.toLowerCase());
  assert.ok(qs.some((q) => q.includes("what can ghostchat do")));
  assert.ok(qs.some((q) => q.includes("how much")));
  assert.ok(qs.some((q) => q.includes("widget")));
  assert.ok(qs.some((q) => q.includes("yearly")));
  assert.ok(GHOSTCHAT_EVAL_QUESTIONS.every((q) => q.expect.trim().length >= 2));
});
