import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeAnalytics, type LogRow } from "../server/src/lib/analytics.ts";
import { resolveTopicTags, topicBreakdown, topicTagsFromText } from "../server/src/lib/topicTags.ts";

test("visitor questions get keyword topic tags without a paid model", () => {
  assert.deepEqual(topicTagsFromText("How long does shipping to Ireland take?"), ["shipping"]);
  assert.ok(topicTagsFromText("Can I get a refund if I return this?").includes("returns"));
  assert.ok(topicTagsFromText("What does the Pro plan cost per month?").includes("pricing"));
  assert.equal(topicTagsFromText("hi").length, 0);
  assert.deepEqual(resolveTopicTags("hello", ["shipping"]), ["shipping"]);
  const rows: LogRow[] = [
    { id: "1", session_id: "a", role: "user", message: "Do you ship to Ireland?", was_unsure: false, feedback: null, page_url: null, created_at: "2026-11-18T08:00:00.000Z" },
    { id: "2", session_id: "a", role: "assistant", message: "Yes.", was_unsure: false, feedback: null, page_url: null, created_at: "2026-11-18T08:00:01.000Z" },
    { id: "3", session_id: "b", role: "user", message: "Shipping to France?", was_unsure: false, feedback: null, page_url: null, created_at: "2026-11-18T08:01:00.000Z" },
  ];
  const topics = topicBreakdown(rows);
  assert.equal(topics[0]?.tag, "shipping");
  assert.equal(topics[0]?.conversations, 2);
  const a = computeAnalytics({ logs: rows, leads: 0, timeZone: "UTC", now: new Date("2026-11-18T12:00:00Z") });
  assert.equal(a.topics[0]?.tag, "shipping");
});

test("transcripts and analytics expose a topic filter", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const live = readFileSync(new URL("../server/src/lib/live.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  assert.match(html, /id="log-topic"/);
  assert.match(js, /openTranscriptsByTopic/);
  assert.match(js, /data-open-topic/);
  assert.match(routes, /topic_tags/);
  assert.match(routes, /req\.query\.tag/);
  assert.match(live, /topicTagsFromText/);
  assert.match(i18n, /logs\.allTopics/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
