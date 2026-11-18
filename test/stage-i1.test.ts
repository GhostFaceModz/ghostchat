import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diffEvalRuns } from "../server/src/lib/evalSet.ts";

test("eval run diffs flag questions that got better or worse", () => {
  const prev = [
    { id: "a", question: "How much is Pro?", pass: false },
    { id: "b", question: "Do you ship to Ireland?", pass: true },
    { id: "c", question: "What is the refund window?", pass: true },
  ];
  const curr = [
    { id: "a", question: "How much is Pro?", pass: true },
    { id: "b", question: "Do you ship to Ireland?", pass: false },
    { id: "d", question: "How do I cancel?", pass: true },
  ];
  const diff = diffEvalRuns(prev, curr);
  assert.deepEqual(diff.better.map((x) => x.question), ["How much is Pro?"]);
  assert.deepEqual(diff.worse.map((x) => x.question), ["Do you ship to Ireland?"]);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].question, "How do I cancel?");
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].question, "What is the refund window?");
  assert.equal(diff.previousPassed, 2);
  assert.equal(diff.previousTotal, 3);
  const first = diffEvalRuns(null, curr);
  assert.equal(first.previousTotal, null);
  assert.equal(first.better.length, 0);
});

test("eval history is stored and shown next to the train-tab runner", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../server/src/lib/evalSet.ts", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20261118150000_ghostchat_eval_runs.sql", import.meta.url), "utf8");
  assert.match(html, /id="eval-history"/);
  assert.match(html, /id="eval-diff"/);
  assert.match(js, /renderEvalDiff/);
  assert.match(js, /\/eval\/runs/);
  assert.match(routes, /eval\/runs/);
  assert.match(routes, /runAndStoreEvalSet/);
  assert.match(lib, /ghostchat_eval_runs/);
  assert.match(sql, /ghostchat_eval_runs/);
  assert.match(i18n, /eval.history/);
  assert.match(i18n, /eval.better/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`\\b${lang}: \\{`));
  }
});
