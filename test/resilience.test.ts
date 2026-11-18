import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { backoffMs, isRetryable, _test, AiUnavailableError, FREE_OPENROUTER_FALLBACK, FREE_OPENROUTER_FALLBACKS, clearPaidCreditSkip } from "../server/src/lib/ai.ts";
import { chatRateLimit } from "../server/src/routes/chat.ts";
import { dailyCapCheck, dailyCap, DEMO_DAILY_CAP } from "../server/src/lib/usage.ts";
import { DEMO_SITE_KEY } from "../server/src/lib/demoSite.ts";
import { HUMAN_REQUEST } from "../server/src/lib/guardrails.ts";
import { selectCards } from "../server/src/lib/cards.ts";

const resolved = { provider: "openrouter", baseUrl: "https://x.test", apiKey: "k", model: "m", headers: {} } as never;

beforeEach(() => clearPaidCreditSkip());

test("retries 429/5xx up to twice, then gives up gracefully", async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response("busy", { status: 429, headers: { "retry-after": "0.01" } }); }) as typeof fetch;
  await assert.rejects(_test.aiFetch(resolved, "/chat/completions", {}, false, fake), AiUnavailableError);
  assert.equal(calls, 3);
});

test("succeeds after a transient 503", async () => {
  let calls = 0;
  const fake = (async () => { calls++; return calls === 1 ? new Response("x", { status: 503, headers: { "retry-after": "0.01" } }) : new Response("{}", { status: 200 }); }) as typeof fetch;
  const res = await _test.aiFetch(resolved, "/chat/completions", {}, false, fake);
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test("does not retry a 400", async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response("bad", { status: 400 }); }) as typeof fetch;
  await assert.rejects(_test.aiFetch(resolved, "/x", {}, false, fake));
  assert.equal(calls, 1);
});

test("backoff and retryable statuses", () => {
  assert.ok(isRetryable(429) && isRetryable(502) && !isRetryable(401));
  assert.equal(backoffMs(0, "2"), 2000);
  assert.ok(backoffMs(1) > backoffMs(0) * 1.5);
});

test("chat rate limit: 6 per minute per visitor, friendly message", async () => {
  const ip = "203.0.113." + Math.floor(Math.random() * 200);
  for (let i = 0; i < 6; i++) assert.equal(await chatRateLimit(ip, "gc_t", "s1"), null);
  const r = await chatRateLimit(ip, "gc_t", "s1");
  assert.ok(r && /slow down/i.test(r.message) && r.retryAfterSec > 0);
});

test("daily cap follows the plan allowance", () => {
  const site = { id: "site-cap-" + Math.random(), plan: "free" } as never;
  const cap = dailyCap(site);
  assert.equal(cap, 25);
  for (let i = 0; i < cap; i++) assert.ok(dailyCapCheck(site).ok);
  assert.equal(dailyCapCheck(site).ok, false);
  assert.equal(dailyCap({ plan: "business" } as never), 2500);
});

test("official demo site gets a higher daily cap; other free sites stay at the plan cap", () => {
  assert.equal(DEMO_DAILY_CAP, 300);
  assert.equal(dailyCap({ plan: "free", site_key: DEMO_SITE_KEY } as never), 300);
  assert.equal(dailyCap({ plan: "free", site_key: "gc_someone_else" } as never), 25);
  assert.equal(dailyCap({ plan: "pro", site_key: DEMO_SITE_KEY } as never), 300, "demo cap is by site key, not plan");
});

test("human follow-up form only when handoff is due", () => {
  const site = { conversation_cards: [], conversion_cards: [] } as never;
  assert.equal(selectCards({ site, message: "is it free?", handoff: false }).length, 0);
  assert.equal(selectCards({ site, message: "is it free?", handoff: true })[0].type, "form");
  assert.ok(HUMAN_REQUEST.test("can I talk to a human please"));
  assert.ok(!HUMAN_REQUEST.test("recommend a horror film"));
});

test("retries a 402 from a paid OpenRouter model on a free model", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url: String(url), body });
    if (body.model !== FREE_OPENROUTER_FALLBACK) return new Response("no credits", { status: 402 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const res = await _test.aiFetch(
    { ...resolved, model: "deepseek/deepseek-v4-flash" },
    "/chat/completions",
    { model: "deepseek/deepseek-v4-flash", messages: [] },
    false,
    fake,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.model, FREE_OPENROUTER_FALLBACK);
});

test("does not loop after every free OpenRouter model returns 402", async () => {
  const models: string[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    models.push(body.model);
    return new Response("limited", { status: 402 });
  }) as typeof fetch;
  await assert.rejects(_test.aiFetch({ ...resolved, model: "deepseek/deepseek-v4-flash" }, "/chat/completions", { model: "deepseek/deepseek-v4-flash" }, false, fake));
  assert.deepEqual(models, ["deepseek/deepseek-v4-flash", ...FREE_OPENROUTER_FALLBACKS]);
});

test("a rate-limited free model falls through to the next free model", async () => {
  const models: string[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    models.push(body.model);
    if (body.model === FREE_OPENROUTER_FALLBACKS[0]) return new Response("rate", { status: 429, headers: { "retry-after": "0.01" } });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const res = await _test.aiFetch(
    { ...resolved, model: FREE_OPENROUTER_FALLBACKS[0] },
    "/chat/completions",
    { model: FREE_OPENROUTER_FALLBACKS[0] },
    false,
    fake,
  );
  assert.equal(res.status, 200);
  assert.ok(models.includes(FREE_OPENROUTER_FALLBACKS[0]));
  assert.equal(models.at(-1), FREE_OPENROUTER_FALLBACKS[1]);
});

test("skips a paid OpenRouter model after a recent 402", async () => {
  _test.rememberPaidCreditsExhausted();
  const models: string[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    models.push(body.model);
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
  assert.deepEqual(models, [FREE_OPENROUTER_FALLBACK]);
});

test("a 404 on an unknown free model walks to the next fallback", async () => {
  const models: string[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    models.push(body.model);
    if (body.model === FREE_OPENROUTER_FALLBACKS[0]) return new Response("missing", { status: 404 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const res = await _test.aiFetch(
    { ...resolved, model: FREE_OPENROUTER_FALLBACKS[0] },
    "/chat/completions",
    { model: FREE_OPENROUTER_FALLBACKS[0] },
    false,
    fake,
  );
  assert.equal(res.status, 200);
  assert.equal(models.at(-1), FREE_OPENROUTER_FALLBACKS[1]);
});
