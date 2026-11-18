import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clusterUnanswered, questionTokens, tokenOverlap } from "../server/src/lib/analytics.ts";

test("similar unanswered questions cluster by shared tokens", () => {
  assert.ok(questionTokens("How much is the Pro plan?").includes("pro"));
  assert.ok(tokenOverlap(questionTokens("How much is the Pro plan?"), questionTokens("What does the Pro plan cost?")) >= 0.5);
  const clusters = clusterUnanswered([
    { logId: "1", question: "How much is the Pro plan?", created_at: "2026-11-18T10:00:00Z" },
    { logId: "2", question: "What does the Pro plan cost?", created_at: "2026-11-18T11:00:00Z" },
    { logId: "3", question: "Do you ship to France?", created_at: "2026-11-18T12:00:00Z" },
  ]);
  const priced = clusters.find((c) => c.count >= 2);
  assert.ok(priced, "pricing questions should share a cluster");
  assert.equal(priced.count, 2);
  assert.ok(priced.questions.some((q) => /pro plan/i.test(q)));
  const ship = clusters.find((c) => c.questions.some((q) => /france/i.test(q)));
  assert.equal(ship?.count, 1);
});

test("analytics and transcripts UI expose clusters and search", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  assert.match(html, /log-search/);
  assert.match(js, /unansweredClusters/);
  assert.match(js, /\/api\/sites\/" \+ state\.site\.id \+ "\/logs/);
  assert.match(routes, /req\.query\.q/);
  assert.match(routes, /\.ilike\("message"/);
});
