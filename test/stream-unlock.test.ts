import assert from "node:assert/strict";
import { test, after } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import express from "express";
import type { Server } from "node:http";
import { releaseStreamDone, streamDoneSuggestions, isOffsiteMath, maybeSuggestions, shouldSkipSuggestionLlm } from "../server/src/lib/chat.js";
import { streamOpenRouterAttempt, _test as aiTest, backgroundChatModel, clearPaidCreditSkip } from "../server/src/lib/ai.js";
import { chatRouter, chatTestHooks, startSseHeartbeat } from "../server/src/routes/chat.js";
import { ruleIntent, classifyIntent } from "../server/src/lib/intent.js";
import { toolTurn } from "../server/src/lib/recommend.js";
import type { Site } from "../server/src/types.js";
import type { SearchTool } from "../server/src/lib/siteTools.js";

after(() => {
  chatTestHooks.loadSite = undefined;
  chatTestHooks.streamAnswer = undefined;
  chatTestHooks.assertCanSend = undefined;
  delete process.env.SSE_HEARTBEAT_MS;
  delete process.env.OPENROUTER_MODEL;
  clearPaidCreditSkip();
});

test("stream done is published before a hanging follow-up resolves", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = releaseStreamDone({
    suggestions: ["What can you do?"],
    insertLog: async () => { order.push("log"); return "log-1"; },
    emit: (event) => { order.push(String(event.type)); assert.equal(event.assistantLogId, "log-1"); },
    payload: { answer: "4" },
    after: () => gate.then(() => { order.push("after"); }),
  });
  const id = await pending;
  assert.equal(id, "log-1");
  assert.deepEqual(order, ["log", "done"]);
  release();
  await gate;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ["log", "done", "after"]);
});

test("streamAnswer does not await maybeSuggestions before done", () => {
  const src = readFileSync(new URL("../server/src/lib/chat.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function streamAnswer");
  assert.ok(start > 0);
  const body = src.slice(start);
  assert.match(body, /streamDoneSuggestions\(/);
  assert.match(body, /releaseStreamDone\(/);
  assert.doesNotMatch(body, /await maybeSuggestions/);
});

test("streamed suggestions are the starter list and never a model call", () => {
  const site = { starter_questions: ["What can you do?", "Pricing?"], max_suggestions: 2 } as Site;
  assert.deepEqual(streamDoneSuggestions(site, false), ["What can you do?", "Pricing?"]);
  assert.equal(isOffsiteMath("2+2?"), true);
  assert.equal(isOffsiteMath("what's 2 + 2"), true);
  assert.equal(isOffsiteMath("video won't play"), false);
  assert.equal(isOffsiteMath("List me top movies on ghostflix and recommend one"), false);
});

test("free-model suggestion helper does not call OpenRouter", async () => {
  const site = { starter_questions: ["What can you do?"], max_suggestions: 2, chat_provider: "openrouter", chat_model: "google/gemma-4-31b-it:free" } as Site;
  assert.equal(shouldSkipSuggestionLlm(site), true);
  let called = false;
  const prev = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = (async () => { called = true; return new Response("no", { status: 500 }); }) as typeof fetch;
  try {
    assert.deepEqual(await maybeSuggestions(site, "2+2?", "4", false), ["What can you do?"]);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = prev;
    delete process.env.OPENROUTER_API_KEY;
  }
});

test("streamOpenRouterAttempt finishes on data: [DONE] without waiting for EOF", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"4"}}]}\n\ndata: [DONE]'));
    },
    pull() {
      return new Promise(() => {});
    },
    cancel() { cancelled = true; },
  });
  const tokens = await Promise.race([
    (async () => {
      const out: string[] = [];
      for await (const token of streamOpenRouterAttempt(stream, 5000)) out.push(token);
      return out;
    })(),
    new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("waited for upstream EOF")), 800)),
  ]);
  assert.deepEqual(tokens, ["4"]);
  assert.equal(cancelled, true);
});

test("a free OPENROUTER_MODEL replaces the paid flash default before the first request", async () => {
  process.env.OPENROUTER_MODEL = "google/gemma-4-31b-it:free";
  const models: string[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body || "{}")).model);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const resolved = { provider: "openrouter", baseUrl: "https://x.test", apiKey: "k", model: "deepseek/deepseek-v4-flash", headers: {} } as never;
  const res = await aiTest.aiFetch(resolved, "/chat/completions", { model: "deepseek/deepseek-v4-flash", messages: [] }, false, fake);
  assert.equal(res.status, 200);
  assert.deepEqual(models, ["google/gemma-4-31b-it:free"]);
  assert.equal(backgroundChatModel("deepseek/deepseek-v4-flash"), "google/gemma-4-31b-it:free");
  delete process.env.OPENROUTER_MODEL;
});

test("SSE heartbeat pings while the reply is open and done still closes the response", async () => {
  process.env.SSE_HEARTBEAT_MS = "30";
  chatTestHooks.loadSite = async () => ({
    id: "site-sse",
    site_key: "gc_sse",
    name: "GhostFlix",
    url: "https://example.com",
    plan: "free",
    chat_provider: "openrouter",
    chat_model: "google/gemma-4-31b-it:free",
    bot_mode: "assistant",
    owner_id: "owner",
    messages_this_period: 0,
    period_start: new Date().toISOString(),
  }) as Site;
  chatTestHooks.assertCanSend = async (site) => site;
  chatTestHooks.streamAnswer = async ({ onEvent }) => {
    onEvent({ type: "token", text: "General knowledge (not from this site): 2 + 2 = 4." });
    await new Promise((resolve) => setTimeout(resolve, 120));
    onEvent({ type: "done", answer: "4", suggestions: ["What can you do?"] });
    return { answer: "4", unsure: false, sources: [], suggestions: ["What can you do?"], cards: [], userLogId: "u", assistantLogId: "a" };
  };
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRouter);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteKey: "gc_sse", message: "2+2?", sessionId: "s1", stream: true }),
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /: ping/);
    assert.match(text, /"type":"done"/);
    assert.match(text, /2 \+ 2 = 4/);
  } finally {
    chatTestHooks.loadSite = undefined;
    chatTestHooks.streamAnswer = undefined;
    chatTestHooks.assertCanSend = undefined;
    delete process.env.SSE_HEARTBEAT_MS;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve(undefined))));
  }
});

test("SSE comments stop once the response has ended", async () => {
  const chunks: string[] = [];
  let ended = false;
  const stop = startSseHeartbeat((chunk) => chunks.push(chunk), () => ended, 20);
  await new Promise((resolve) => setTimeout(resolve, 70));
  stop();
  ended = true;
  const n = chunks.length;
  assert.ok(n >= 1);
  assert.ok(chunks.every((chunk) => chunk.startsWith(": ping")));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(chunks.length, n);
});

test("ruleIntent catches top, best, popular and trending catalogue requests", () => {
  const phrases = [
    ["List me top movies on ghostflix and recommend one", "movie", "top"],
    ["top shows", "tv", "top"],
    ["best movies", "movie", "best"],
    ["popular movies", "movie", "popular"],
    ["trending movies", "movie", "trending"],
  ] as const;
  for (const [phrase, type, sort] of phrases) {
    const intent = ruleIntent(phrase);
    assert.equal(intent.intent, "recommend", phrase);
    assert.equal(intent.filters.type, type, phrase);
    assert.equal(intent.filters.sort, sort, phrase);
  }
});

test("top-movie intent skips the model and still returns catalogue cards", async () => {
  let fetched = false;
  const prev = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "google/gemma-4-31b-it:free";
  globalThis.fetch = (async () => { fetched = true; return new Response("no", { status: 500 }); }) as typeof fetch;
  try {
    const intent = await classifyIntent("List me top movies on ghostflix and recommend one");
    assert.equal(intent.source, "rules");
    assert.equal(intent.filters.sort, "top");
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = prev;
  }

  let asked = false;
  const tool: SearchTool = {
    id: "gf", name: "GhostFlix picks", kind: "json",
    url_template: "https://example.com/api/public/picks?q={query}&type={type}&sort={sort}",
    items_path: "results", fields: { title: "title", url: "url" },
    intents: ["recommend", "find"], button_label: "Watch", enabled: true,
  };
  const site = { id: "site-1", name: "GhostFlix", search_tools: [tool] } as Site;
  const out = await toolTurn(site, "s1", "List me top movies on ghostflix and recommend one", {
    classify: async (msg) => ruleIntent(msg),
    fetcher: (async () => new Response(JSON.stringify({ results: [{ title: "Alien", url: "https://ghostflix.example/title/movie/1" }] }))) as typeof fetch,
    ask: (async () => { asked = true; return "{}"; }) as never,
  });
  assert.equal(asked, false);
  assert.match(out!.answer, /Alien/);
  assert.equal(out!.results[0].url, "https://ghostflix.example/title/movie/1");
});

test("widget stall watchdog finalizes text and re-enables send", async () => {
  const src = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
  const start = src.indexOf("function consumeSseLines");
  const end = src.indexOf("function sendMessage");
  assert.ok(start >= 0 && end > start);
  const ctx: Record<string, unknown> = { setTimeout, clearTimeout };
  vm.runInNewContext(
    src.slice(start, end) +
      "; this.consumeSseLines = consumeSseLines;" +
      " this.takeCompleteSseLines = takeCompleteSseLines;" +
      " this.drainSseBuffer = drainSseBuffer;" +
      " this.feedbackButtonIds = feedbackButtonIds;" +
      " this.syncSendLocked = syncSendLocked;" +
      " this.createStreamWatchdog = createStreamWatchdog;",
    ctx,
  );
  const api = ctx as {
    drainSseBuffer: (buf: string, handle: (line: string) => void) => string;
    feedbackButtonIds: (logId: string, text: string) => string[];
    syncSendLocked: (sending: boolean) => boolean;
    createStreamWatchdog: (opts: { idleMs: number; ceilingMs: number; onStall: (reason: string) => void }) => {
      start: () => void;
      received: (hasText: boolean) => void;
      stop: () => void;
    };
  };
  const lines: string[] = [];
  api.drainSseBuffer('data: {"type":"token","text":"4"}\ndata: {"type":"done","answer":"4"}', (line) => lines.push(line.trim()));
  assert.equal(lines.length, 2);
  const ids = (logId: string, text: string) => JSON.stringify(api.feedbackButtonIds(logId, text));
  assert.equal(ids("", "4"), JSON.stringify(["copy", "speak"]));
  assert.equal(ids("log-1", "4"), JSON.stringify(["copy", "up", "down", "speak"]));
  assert.equal(api.syncSendLocked(false), false);
  assert.equal(api.syncSendLocked(true), true);

  const reasons: string[] = [];
  const watch = api.createStreamWatchdog({ idleMs: 40, ceilingMs: 5000, onStall: (reason) => reasons.push(reason) });
  watch.start();
  watch.received(true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(JSON.stringify(reasons.map(String)), JSON.stringify(["idle"]));

  const send = src.slice(src.indexOf("function sendMessage"));
  assert.match(send, /finally \{[\s\S]*state\.sending = false/);
  assert.match(send, /drainSseBuffer\(buf, handleLine\)/);
  assert.match(send, /createStreamWatchdog/);
  assert.match(src, /function addFeedback\(row, logId, text\) \{\s*if \(!logId && !text\) return;/);
});

test("render.yaml boots chat on a free OpenRouter model", () => {
  const yaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(yaml, /OPENROUTER_MODEL\s*\n\s*value: google\/gemma-4-31b-it:free/);
  assert.doesNotMatch(yaml, /OPENROUTER_MODEL\s*\n\s*value: deepseek\/deepseek-v4-flash/);
});
