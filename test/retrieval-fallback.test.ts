import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { retrievalOnlyAnswer, trivialGreetingReply, TEMP_OUTAGE_REPLY, labelGeneralKnowledge, buildSystemPrompt } from "../server/src/lib/chat.ts";
import { isBroadQuestion, rerankChunks } from "../server/src/lib/retrievalRerank.ts";
import { expandSearchQuery } from "../server/src/lib/queryRewrite.ts";
import { classifyIntent, ruleIntent } from "../server/src/lib/intent.ts";
import { _test, clearPaidCreditSkip, isFreeOpenRouterModel } from "../server/src/lib/ai.ts";
import { clearPoolState, isCooling, poolHealth, recordPoolFailure, recordPoolSuccess, setPoolForTests } from "../server/src/lib/freeModelPool.ts";
import type { RetrievedChunk, Site } from "../server/src/types.ts";

function chunk(partial: Partial<RetrievedChunk> & { content: string; id: string }): RetrievedChunk {
  return { site_id: "s", url: null, title: null, similarity: 0.8, ...partial };
}

const resolved = { provider: "openrouter", baseUrl: "https://x.test", apiKey: "k", model: "m", headers: {} } as never;

beforeEach(() => {
  clearPaidCreditSkip();
  clearPoolState();
  _test.clearReasoningRequired();
});

describe("retrievalOnlyAnswer", () => {
  it("returns null when there are no useful chunks", () => {
    assert.equal(retrievalOnlyAnswer([]), null);
    assert.equal(retrievalOnlyAnswer([chunk({ id: "1", content: "too short" })]), null);
  });

  it("returns only the best FAQ, with one markdown link", () => {
    const result = retrievalOnlyAnswer([
      chunk({
        id: "home",
        title: "GhostFlix",
        heading: "About",
        url: "https://ghostflix.uk/",
        similarity: 0.9,
        content: "GhostFlix is a free movie site. Browse the homepage, read the about blurb, and see every featured row on the landing page before you pick a title.",
      }),
      chunk({
        id: "faq",
        title: "Playback help",
        heading: "Black screen",
        url: "https://ghostflix.uk/help/playback",
        similarity: 0.86,
        content: "If the player stays black, switch source once and pause for a few seconds so the next host can buffer. Most titles start after the second source.",
      }),
    ], { question: "the video is a black screen", maxSources: 1 });
    assert.ok(result);
    assert.match(result!.answer, /switch source once/);
    assert.match(result!.answer, /\[Black screen\]\(https:\/\/ghostflix\.uk\/help\/playback\)/);
    assert.equal(result!.sources.length, 1);
    assert.doesNotMatch(result!.answer, /Here's what I found/);
    assert.doesNotMatch(result!.answer, /homepage/);
    assert.equal((result!.answer.match(/https:\/\//g) || []).length, 1);
  });

  it("does not dump homepage chunks for 2+2 or a movie search", () => {
    const home = [
      chunk({
        id: "h",
        title: "GhostFlix",
        url: "https://ghostflix.uk/",
        similarity: 0.84,
        content: "Welcome to GhostFlix. This homepage explains the catalogue, the about section, and how to browse movies and shows from the landing page.",
      }),
      chunk({
        id: "a",
        title: "About",
        url: "https://ghostflix.uk/about",
        similarity: 0.8,
        content: "About GhostFlix. We built a free place to find movies and read short descriptions before you hit play on a title page.",
      }),
    ];
    for (const question of ["2+2", "list movies like snatch"]) {
      const result = retrievalOnlyAnswer(home, { question, maxSources: 3 });
      assert.ok(result);
      assert.equal(result!.answer, TEMP_OUTAGE_REPLY);
      assert.equal(result!.sources.length, 0);
      assert.doesNotMatch(result!.answer, /https:\/\//);
    }
  });

  it("respects max_sources and can still answer an overview from the homepage", () => {
    const result = retrievalOnlyAnswer([
      chunk({
        id: "h",
        title: "GhostChat",
        heading: "What you can build",
        url: "https://ghostchat.pro/",
        similarity: 0.9,
        content: "GhostChat learns your pages and answers visitors in your brand voice. It shows sources under each reply and can hand the chat to a person.",
      }),
    ], { question: "What can GhostChat do?", maxSources: 0 });
    assert.ok(result);
    assert.match(result!.answer, /brand voice/);
    assert.equal(result!.sources.length, 0);
    assert.doesNotMatch(result!.answer, /https:\/\//);
  });
});

describe("overview gating, greetings, and query normalization", () => {
  it("does not treat greetings, help, or arithmetic as overview questions", () => {
    assert.equal(isBroadQuestion("What can ghostchat do"), true);
    assert.equal(isBroadQuestion("hi"), false);
    assert.equal(isBroadQuestion("hello there"), false);
    assert.equal(isBroadQuestion("help"), false);
    assert.equal(isBroadQuestion("2+2"), false);
    assert.equal(isBroadQuestion("list movies like snatch"), false);
  });

  it("does not inject homepage chunks into an unrelated query", () => {
    const overview = chunk({
      id: "h",
      url: "https://ghostchat.pro/",
      title: "GhostChat",
      heading: "What you can build",
      content: "GhostChat is a premium AI assistant that learns your pages and answers visitors.",
      similarity: 0.55,
    });
    const faq = chunk({
      id: "f",
      url: "https://ghostchat.pro/help/widget",
      title: "Install",
      content: "Paste the widget script before the closing body tag to install GhostChat.",
      similarity: 0.7,
    });
    const ranked = rerankChunks("how do I install the widget", [faq], { overview: [overview], keep: 4 });
    assert.deepEqual(ranked.map((c) => c.id), ["f"]);
  });

  it("expands install, playback, and pricing words and fixes typos", () => {
    assert.match(expandSearchQuery("apk for android"), /install/);
    assert.match(expandSearchQuery("the video won't play, black screen"), /playback/);
    assert.match(expandSearchQuery("is it free"), /pricing/);
    assert.match(expandSearchQuery("moives like snatch"), /^movies like snatch/);
  });

  it("greets without sounding like a homepage dump", () => {
    assert.match(trivialGreetingReply({ name: "GhostFlix" }, "hi") || "", /GhostFlix/);
    assert.match(trivialGreetingReply({ name: "GhostGames" }, "good morning!") || "", /GhostGames/);
    assert.equal(trivialGreetingReply({ name: "GhostFlix" }, "list movies like snatch"), null);
    assert.equal(trivialGreetingReply({ name: "GhostFlix" }, "2+2"), null);
  });

  it("does not stamp general knowledge onto a site question", () => {
    const site = { name: "GhostFlix", url: "https://ghostflix.uk", answer_mode: "helpful", plan: "free" } as Site;
    const chunks = [chunk({ id: "1", content: "GhostFlix streams movies in the browser with a source picker when one host is down.", url: "https://ghostflix.uk/help", similarity: 0.8 })];
    const answer = "Try the next source if playback stalls.";
    assert.equal(labelGeneralKnowledge(site, answer, chunks, false, "black screen won't play"), answer);
    assert.match(labelGeneralKnowledge(site, "Four.", chunks, false, "2+2"), /General knowledge/);
    assert.match(buildSystemPrompt(site, []), /1–3 sentences|1-3 sentences/);
    assert.match(buildSystemPrompt(site, []), /markdown/);
    assert.match(buildSystemPrompt(site, []), /genuinely off-site/);
  });
});

describe("rule intent skips the model", () => {
  it("classifies movie-like phrasing, including typos, without calling the model", async () => {
    let calls = 0;
    const intent = await classifyIntent("Liat movies too watch like snatch", [], async () => {
      calls += 1;
      return "{\"intent\":\"other\"}";
    });
    assert.equal(calls, 0);
    assert.equal(intent.intent, "recommend");
    assert.equal(intent.filters.similar_to?.toLowerCase(), "snatch");
    assert.equal(ruleIntent("do you have The Gentlemen").intent, "find");
  });
});

describe("free model failover", () => {
  it("retries a reasoning-mandatory 400 on the same model and does not cool it for an hour", async () => {
    setPoolForTests(["baidu/ernie-5.5-flash-preview:free", "google/gemma-4-31b-it:free"]);
    const calls: Array<Record<string, unknown>> = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push(body);
      const reasoning = body.reasoning as { enabled?: boolean } | undefined;
      if (reasoning?.enabled === false) {
        return new Response(JSON.stringify({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as typeof fetch;
    const res = await _test.aiFetch(
      { ...resolved, model: "baidu/ernie-5.5-flash-preview:free" },
      "/chat/completions",
      { model: "baidu/ernie-5.5-flash-preview:free", reasoning: { enabled: false }, max_tokens: 200 },
      false,
      fake,
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].model, "baidu/ernie-5.5-flash-preview:free");
    assert.notEqual((calls[1].reasoning as { enabled?: boolean }).enabled, false);
    assert.equal(isCooling("baidu/ernie-5.5-flash-preview:free"), false);
    const body = _test.chatBody("baidu/ernie-5.5-flash-preview:free", [], { fast: true, maxTokens: 200 });
    assert.notEqual((body.reasoning as { enabled?: boolean }).enabled, false);
    assert.ok(Number(body.max_tokens) >= 1000);
  });

  it("keeps reasoning text out of the answer and retries a reasoning-only reply without an empty ban", async () => {
    const hidden = _test.readAssistantPayload({ choices: [{ message: { content: "", reasoning: "private chain of thought" } }] });
    assert.equal(hidden.text, "");
    assert.equal(hidden.reasoningOnly, true);
    const visible = _test.readAssistantPayload({ choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "4" }] } }] });
    assert.equal(visible.text, "4");

    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    setPoolForTests(["google/gemma-4-31b-it:free", "openrouter/free"]);
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning: "thinking about 2+2" } }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "4" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const text = await (await import("../server/src/lib/ai.ts")).completeChat(
        [{ role: "user", content: "2+2" }],
        { site: { chat_provider: "openrouter", chat_model: "google/gemma-4-31b-it:free" } },
        fake,
      );
      assert.equal(text, "4");
      assert.equal(calls, 2);
      assert.equal(isCooling("google/gemma-4-31b-it:free"), false);
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
    }
  });

  it("after a paid 402, retries the last free success instead of the paid model", async () => {
    setPoolForTests(["a:free", "b:free", "openrouter/free"]);
    recordPoolSuccess("b:free");
    recordPoolFailure("a:free", "429");
    recordPoolFailure("b:free", "empty");
    recordPoolFailure("openrouter/free", "timeout");
    _test.rememberPaidCreditsExhausted();
    const models: string[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
      models.push(String(body.model));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const res = await _test.aiFetch(
      { ...resolved, model: "deepseek/deepseek-v4-flash" },
      "/chat/completions",
      { model: "deepseek/deepseek-v4-flash" },
      false,
      fake,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(models, ["b:free"]);
    assert.equal(isFreeOpenRouterModel("openrouter/free"), true);
    const cooled = poolHealth().members.find((m) => m.id === "a:free");
    assert.equal(cooled?.cooling, true);
  });

  it("streamChat hops when the first free model streams only reasoning", async () => {
    setPoolForTests(["a:free", "b:free"]);
    const models: string[] = [];
    const sse = (payload: unknown) => new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    const fake = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
      models.push(String(body.model));
      if (body.model === "a:free") return sse({ choices: [{ delta: { reasoning: "hidden thoughts", content: "" } }] });
      return sse({ choices: [{ delta: { content: "Hello" } }] });
    }) as typeof fetch;
    let out = "";
    for await (const token of _test.streamResolvedChat({ ...resolved, model: "a:free" }, [{ role: "user", content: "hi" }], {}, fake)) out += token;
    assert.equal(out, "Hello");
    assert.deepEqual(models, ["a:free", "b:free"]);
    assert.equal(isCooling("a:free"), true);
    const until = poolHealth().members.find((m) => m.id === "a:free")?.cooldownUntil ?? 0;
    assert.ok(until - Date.now() <= 180_000);
  });
});
