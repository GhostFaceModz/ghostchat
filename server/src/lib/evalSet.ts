/** Training eval set: keyword checks against retrieved sources (optional full answers). */
import { getDb } from "./supabase.js";
import { retrieveChunks } from "./chat.js";
import type { Site } from "../types.js";

export function parseExpect(raw: string): string[] {
  return String(raw || "")
    .split(/[\n,;]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2)
    .slice(0, 12);
}

export function scoreExpect(haystack: string, expect: string[]): { pass: boolean; matched: string[]; missing: string[] } {
  const hay = String(haystack || "").toLowerCase();
  if (!expect.length) {
    const pass = hay.replace(/\s+/g, " ").trim().length >= 40;
    return { pass, matched: [], missing: pass ? [] : ["(no sources found)"] };
  }
  const matched: string[] = [];
  const missing: string[] = [];
  for (const phrase of expect) {
    if (hay.includes(phrase.toLowerCase())) matched.push(phrase);
    else missing.push(phrase);
  }
  return { pass: missing.length === 0, matched, missing };
}

export async function listEvalQuestions(siteId: string) {
  const { data, error } = await getDb()
    .from("ghostchat_eval_questions")
    .select("id, question, expect, sort, created_at")
    .eq("site_id", siteId)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addEvalQuestion(siteId: string, input: { question: string; expect?: string }) {
  const question = String(input.question || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (question.length < 8) throw Object.assign(new Error("Write a question of at least a few words."), { status: 400 });
  const { count } = await getDb().from("ghostchat_eval_questions").select("id", { count: "exact", head: true }).eq("site_id", siteId);
  if ((count ?? 0) >= 40) throw Object.assign(new Error("You can save up to 40 eval questions per site."), { status: 400 });
  const { data, error } = await getDb()
    .from("ghostchat_eval_questions")
    .insert({
      site_id: siteId,
      question,
      expect: String(input.expect || "").trim().slice(0, 1000),
      sort: count ?? 0,
    })
    .select("id, question, expect, sort, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEvalQuestion(siteId: string, id: string) {
  const { error } = await getDb().from("ghostchat_eval_questions").delete().eq("id", id).eq("site_id", siteId);
  if (error) throw error;
}

export async function runEvalQuestion(site: Site, item: { question: string; expect: string }, opts: { staging?: boolean } = {}) {
  const expect = parseExpect(item.expect);
  const chunks = await retrieveChunks(site.id, item.question, [], { staging: Boolean(opts.staging || site.staging) });
  const haystack = chunks.map((c) => [c.title, c.heading, c.content, c.url].filter(Boolean).join("\n")).join("\n\n");
  const score = scoreExpect(haystack, expect);
  return {
    question: item.question,
    expect,
    pass: score.pass,
    matched: score.matched,
    missing: score.missing,
    sources: chunks.slice(0, 4).map((c) => ({ title: c.title, url: c.url })),
  };
}

export async function runEvalSet(site: Site, opts: { staging?: boolean } = {}) {
  const items = await listEvalQuestions(site.id);
  const results = [];
  for (const item of items) {
    results.push({ id: item.id, ...(await runEvalQuestion(site, { question: item.question, expect: item.expect || "" }, opts)) });
  }
  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

export type EvalRunResult = {
  id?: string | null;
  question: string;
  pass: boolean;
  matched?: string[];
  missing?: string[];
  sources?: Array<{ title?: string | null; url?: string | null }>;
};

export type EvalRunRecord = {
  id: string;
  site_id: string;
  staging: boolean;
  total: number;
  passed: number;
  failed: number;
  results: EvalRunResult[];
  created_at: string;
};

function resultKey(r: Pick<EvalRunResult, "id" | "question">) {
  return String(r.id || "").trim() || String(r.question || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function diffEvalRuns(previous: EvalRunResult[] | null | undefined, current: EvalRunResult[]) {
  const prevMap = new Map<string, EvalRunResult>();
  for (const r of previous || []) prevMap.set(resultKey(r), r);
  const better: Array<{ question: string }> = [];
  const worse: Array<{ question: string }> = [];
  const added: Array<{ question: string; pass: boolean }> = [];
  const removed: Array<{ question: string; pass: boolean }> = [];
  const seen = new Set<string>();
  for (const r of current) {
    const key = resultKey(r);
    if (!key) continue;
    seen.add(key);
    const prev = prevMap.get(key);
    if (!prev) {
      added.push({ question: r.question, pass: Boolean(r.pass) });
      continue;
    }
    if (!prev.pass && r.pass) better.push({ question: r.question });
    else if (prev.pass && !r.pass) worse.push({ question: r.question });
  }
  for (const [key, prev] of prevMap) {
    if (!seen.has(key)) removed.push({ question: prev.question, pass: Boolean(prev.pass) });
  }
  return {
    better,
    worse,
    added,
    removed,
    previousPassed: previous ? previous.filter((r) => r.pass).length : null,
    previousTotal: previous ? previous.length : null,
  };
}

const KEEP_RUNS = 50;

export async function saveEvalRun(siteId: string, report: { total: number; passed: number; failed: number; results: EvalRunResult[] }, opts: { staging?: boolean } = {}): Promise<EvalRunRecord> {
  const staging = Boolean(opts.staging);
  const { data, error } = await getDb()
    .from("ghostchat_eval_runs")
    .insert({
      site_id: siteId,
      staging,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      results: report.results,
    })
    .select("id, site_id, staging, total, passed, failed, results, created_at")
    .single();
  if (error) throw error;
  const { data: extra } = await getDb()
    .from("ghostchat_eval_runs")
    .select("id")
    .eq("site_id", siteId)
    .eq("staging", staging)
    .order("created_at", { ascending: false })
    .range(KEEP_RUNS, KEEP_RUNS + 50);
  const drop = (extra ?? []).map((r: { id: string }) => r.id);
  if (drop.length) await getDb().from("ghostchat_eval_runs").delete().in("id", drop);
  return data as EvalRunRecord;
}

export async function listEvalRuns(siteId: string, opts: { staging?: boolean; limit?: number } = {}): Promise<EvalRunRecord[]> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  let q = getDb()
    .from("ghostchat_eval_runs")
    .select("id, site_id, staging, total, passed, failed, results, created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (typeof opts.staging === "boolean") q = q.eq("staging", opts.staging);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EvalRunRecord[];
}

export async function previousEvalRun(siteId: string, opts: { staging?: boolean; before?: string } = {}): Promise<EvalRunRecord | null> {
  let q = getDb()
    .from("ghostchat_eval_runs")
    .select("id, site_id, staging, total, passed, failed, results, created_at")
    .eq("site_id", siteId)
    .eq("staging", Boolean(opts.staging))
    .order("created_at", { ascending: false })
    .limit(1);
  if (opts.before) q = q.lt("created_at", opts.before);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as EvalRunRecord) || null;
}

export async function runAndStoreEvalSet(site: Site, opts: { staging?: boolean } = {}) {
  const report = await runEvalSet(site, opts);
  const previous = await previousEvalRun(site.id, { staging: Boolean(opts.staging) });
  const run = await saveEvalRun(site.id, report, opts);
  const diff = diffEvalRuns(previous?.results, report.results);
  return { ...report, runId: run.id, created_at: run.created_at, previous: previous ? { id: previous.id, passed: previous.passed, total: previous.total, created_at: previous.created_at } : null, diff };
}
