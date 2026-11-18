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
