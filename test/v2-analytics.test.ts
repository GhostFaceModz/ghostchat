import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeAnalytics, hourIn, type LogRow } from "../server/src/lib/analytics.js";
import { planIncremental, contentHash } from "../server/src/lib/indexer.js";
import { correctionChunks, correctionThreshold } from "../server/src/lib/corrections.js";
import { pickSources } from "../server/src/lib/chat.js";
import { localEmbed } from "../server/src/lib/localEmbeddings.js";

const row = (p: Partial<LogRow>): LogRow => ({ id: Math.random().toString(36).slice(2), session_id: "s1", role: "user", message: "hi", was_unsure: false, feedback: null, page_url: null, created_at: "2026-11-14T10:00:00Z", ...p });

test("analytics: top questions, low-confidence list with the visitor question, conversion and busiest hour", () => {
  const logs: LogRow[] = [
    row({ session_id: "a", message: "What are your prices?", created_at: "2026-11-14T18:00:00Z" }),
    row({ session_id: "a", role: "assistant", message: "Pro is £9.", created_at: "2026-11-14T18:00:02Z", feedback: "up" }),
    row({ session_id: "b", message: "what are your prices", created_at: "2026-11-14T18:30:00Z" }),
    row({ session_id: "b", role: "assistant", id: "L1", message: "I'm not sure — I couldn't find that on this site.", was_unsure: true, created_at: "2026-11-14T18:30:02Z" }),
    row({ session_id: "c", message: "Do you ship to France?", created_at: "2026-11-13T09:00:00Z" }),
    row({ session_id: "c", role: "assistant", id: "L2", message: "Yes, everywhere.", feedback: "down", created_at: "2026-11-13T09:00:02Z" }),
  ];
  const a = computeAnalytics({ logs, leads: 1, leadSessions: ["a"], csat: [5, 4], tickets: [{ status: "open" }, { status: "solved" }], timeZone: "UTC", now: new Date("2026-11-14T20:00:00Z") });
  assert.equal(a.topQuestions[0].count, 2);
  assert.equal(a.lowConfidence.length, 2);
  const unsure = a.lowConfidence.find((x) => x.logId === "L1")!;
  assert.equal(unsure.question, "what are your prices");
  assert.equal(unsure.reason, "unsure");
  assert.equal(a.lowConfidence.find((x) => x.logId === "L2")!.reason, "thumbs_down");
  assert.equal(a.conversion.conversations, 3);
  assert.equal(a.conversion.convertedConversations, 1);
  assert.equal(a.conversion.rate, 33.3);
  assert.equal(a.peakHour, 18);
  assert.equal(a.hours[18], 2);
  assert.equal(a.daily.length, 14);
  assert.equal(a.daily.at(-1)!.count, 2);
  assert.equal(a.csat.average, 4.5);
  assert.deepEqual(a.tickets, { open: 1, pending: 0, solved: 1 });
  assert.equal(a.answerRate, 67);
});

test("analytics hours follow the owner's time zone", () => {
  assert.equal(hourIn("2026-07-01T12:00:00Z", "Europe/London"), 13);
  assert.equal(hourIn("2026-07-01T12:00:00Z", "Not/AZone"), 12);
});

test("incremental index plan: unchanged pages are skipped, changed re-embedded, missing crawl pages removed", () => {
  const page = (url: string, text: string) => ({ url, title: url, text });
  const existing = [
    { id: "d1", source_url: "https://x.com/a", content_hash: contentHash("same text here"), source_type: "crawl" },
    { id: "d2", source_url: "https://x.com/b/", content_hash: contentHash("old"), source_type: "crawl" },
    { id: "d3", source_url: "https://x.com/gone", content_hash: "h", source_type: "crawl" },
    { id: "d4", source_url: "https://x.com/looked-up", content_hash: "h", source_type: "lookup" },
  ];
  const plan = planIncremental(existing, [page("https://x.com/a", "same   text here"), page("https://x.com/b", "new"), page("https://x.com/c", "brand new")], { removeMissing: true });
  assert.deepEqual(plan.unchanged, ["d1"]);
  assert.deepEqual(plan.replace.map((r) => r.doc.id), ["d2"]);
  assert.deepEqual(plan.add.map((p) => p.url), ["https://x.com/c"]);
  assert.deepEqual(plan.remove, ["d3"], "live-lookup pages are kept");
  assert.deepEqual(planIncremental(existing, [], { removeMissing: false }).remove, []);
});

test("fix this answer: corrections rank first, are labelled owner-verified, and never show as a source link", async () => {
  const chunks = correctionChunks("site", [{ id: "c1", question: "Do you deliver on Sundays?", answer: "Yes, 10am-2pm.", similarity: 0.5 }]);
  assert.equal(chunks[0].id, "correction:c1");
  assert.match(chunks[0].content, /OWNER-VERIFIED/);
  assert.ok(chunks[0].similarity > 0.7);
  const page = { id: "p", site_id: "site", url: "https://x.com/delivery", title: "Delivery", content: "Delivery Sundays between 10am and 2pm across London postcodes", similarity: 0.5 };
  const sources = pickSources({ max_sources: 1 }, [...chunks, page], "Delivery runs on Sundays between 10am and 2pm across London postcodes.");
  assert.ok(sources.every((s) => s.title !== "Owner-verified answer"));
  process.env.EMBEDDING_PROVIDER = "local";
  const [q1, q2, q3] = await localEmbed(["Do you deliver on Sundays?", "do you do deliveries on a sunday", "How much is the pro plan?"]);
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
  assert.ok(cos(q1, q2) >= correctionThreshold(), `similar question should match (${cos(q1, q2)})`);
  assert.ok(cos(q1, q3) < correctionThreshold(), "unrelated question should not");
});

test("dashboard: analytics charts and Fix this answer UI are wired", () => {
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(js, /Busiest hours/);
  assert.match(js, /lead conversion/);
  assert.match(js, /data-fix=/);
  assert.match(js, /\/corrections/);
  assert.match(html, /id="fix-dialog"/);
});
