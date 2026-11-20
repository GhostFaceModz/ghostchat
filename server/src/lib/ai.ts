import { EMBEDDING_DIMENSIONS, planChatChoice, resolveChatModel, resolveEmbeddingModel, isProviderEnabled, type ProviderId, type ResolvedModel } from "./models.js";
import { loadOwnerKeyMap, isByokPlan } from "./byok.js";
import { isAutoModel, pickAutoRoute } from "./autoRoute.js";
import { modelCreditCost } from "./credits.js";

import {
  FREE_MODEL_TIMEOUT_MS,
  FREE_OPENROUTER_FALLBACK,
  availableFreeModels,
  currentFreePoolIds,
  nextFreeInPool,
  recordPoolFailure,
  recordPoolSuccess,
  type PoolFailureReason,
} from "./freeModelPool.js";
export { FREE_OPENROUTER_FALLBACK, FREE_OPENROUTER_FALLBACKS, poolHealth, startFreeModelPool, refreshFreeModelPool } from "./freeModelPool.js";

export function isFreeOpenRouterModel(model: string): boolean {
  return model.endsWith(":free") || model === "openrouter/free";
}

/** Models that used to be the cold-start default and 402 when the key has no paid credits. */
export function isLegacyPaidDefault(model: string): boolean {
  return /(?:^|\/)deepseek-v4-flash$/.test(model) || /(?:^|\/)gpt-4o-mini$/.test(model);
}

export function paidCreditsBlocked(): boolean {
  return Date.now() < paidCreditSkipUntil;
}

/**
 * Helper calls (intent, suggestions) must not open on a paid id when this deploy is free-first
 * or paid credits were just exhausted. That first paid request is the cold-boot 402.
 */
export function backgroundChatModel(explicit?: string | null): string {
  const env = process.env.OPENROUTER_MODEL?.trim() || "";
  if (isFreeOpenRouterModel(env)) return env;
  if (paidCreditsBlocked()) return availableFreeModels()[0] || FREE_OPENROUTER_FALLBACK;
  return (explicit || process.env.INTENT_MODEL || env || "").trim();
}
import { embedInActiveSpace } from "./embeddingSpace.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Thrown when the AI provider can't answer (after retries); callers show a friendly fallback. */
export class AiUnavailableError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20_000;
export const AI_MAX_RETRIES = 2;
export function chatTimeoutMs(model: string): number {
  return isFreeOpenRouterModel(model) ? FREE_MODEL_TIMEOUT_MS : AI_TIMEOUT_MS;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a 402 on a paid OpenRouter model, skip it for a while (credits stay exhausted). */
const PAID_CREDIT_SKIP_MS = 15 * 60 * 1000;
let paidCreditSkipUntil = 0;

export function clearPaidCreditSkip(): void {
  paidCreditSkipUntil = 0;
}
function rememberPaidCreditsExhausted(): void {
  paidCreditSkipUntil = Date.now() + PAID_CREDIT_SKIP_MS;
}
function shouldSkipPaidOpenRouter(resolved: ResolvedModel): boolean {
  return resolved.provider === "openrouter" && !isFreeOpenRouterModel(String(resolved.model)) && Date.now() < paidCreditSkipUntil;
}

/** Backoff before retry n (0-based): ~0.6s then ~1.8s, honouring Retry-After up to 5s. */
export function backoffMs(attempt: number, retryAfter?: string | null): number {
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.min(5000, ra * 1000);
  return Math.round(600 * Math.pow(3, attempt) * (0.8 + Math.random() * 0.4));
}
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function nextFreeOpenRouter(current: string, used: string[]): string | undefined {
  return nextFreeInPool(current, used);
}

function withModel(body: unknown, model: string): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) return { ...(body as Record<string, unknown>), model };
  return body;
}

async function aiFetch(resolved: ResolvedModel, path: string, body: unknown, stream = false, fetchImpl: typeof fetch = fetch, usedFree: string[] = [], tracker?: { model: string }, allowSwitch = true): Promise<Response> {
  const envModel = process.env.OPENROUTER_MODEL?.trim() || "";
  // Cold boot: paidCreditSkipUntil is still 0, so the old default would 402 once before the skip kicks in.
  if (allowSwitch && resolved.provider === "openrouter" && isFreeOpenRouterModel(envModel) && isLegacyPaidDefault(String(resolved.model))) {
    if (tracker) tracker.model = envModel;
    return aiFetch({ ...resolved, model: envModel }, path, withModel(body, envModel), stream, fetchImpl, usedFree, tracker, allowSwitch);
  }
  if (tracker) tracker.model = String(resolved.model);
  if (!resolved.apiKey) {
    throw new Error(`No API key is configured for ${resolved.provider}.`);
  }
  if (allowSwitch && shouldSkipPaidOpenRouter(resolved)) {
    const next = nextFreeOpenRouter(String(resolved.model), usedFree) || availableFreeModels(usedFree)[0];
    if (next) {
      console.warn(`openrouter paid credits recently exhausted; starting with ${next}`);
      if (tracker) tracker.model = next;
      return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch);
    }
  }
  const freeModel = isFreeOpenRouterModel(String(resolved.model));
  const timeoutMs = chatTimeoutMs(String(resolved.model));
  // Free models: switch immediately (short timeout, no multi-retry on the same dying model).
  const maxAttempts = freeModel ? 0 : AI_MAX_RETRIES;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${resolved.baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${resolved.apiKey}`, "content-type": "application/json", ...resolved.headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastStatus = undefined;
      const timedOut = (err as Error).name === "AbortError";
      const reason: PoolFailureReason = timedOut ? "timeout" : "error";
      if (freeModel) recordPoolFailure(String(resolved.model), reason);
      const next = allowSwitch && resolved.provider === "openrouter" ? nextFreeOpenRouter(String(resolved.model), usedFree) : undefined;
      if (next) {
        console.warn(`openrouter ${reason} on ${resolved.model}; retrying with ${next}`);
        if (tracker) tracker.model = next;
        return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch);
      }
      if (!freeModel && attempt < maxAttempts) { await sleep(backoffMs(attempt)); continue; }
      throw new AiUnavailableError(`${resolved.provider} request failed: ${timedOut ? "timed out" : (err as Error).message}`);
    }
    clearTimeout(timer);
    if (res.ok) {
      if (stream && !res.body) throw new AiUnavailableError(`${resolved.provider} did not return a stream`);
      return res;
    }
    lastStatus = res.status;
    const text = await res.text().catch(() => "");
    const isFree = isFreeOpenRouterModel(String(resolved.model));
    if (res.status === 402 && !isFree) rememberPaidCreditsExhausted();
    if (isFree && (res.status === 429 || res.status === 404 || res.status === 400 || res.status === 402 || res.status >= 500)) {
      const reason: PoolFailureReason = res.status === 429 ? "429" : res.status === 404 ? "404" : res.status === 400 ? "400" : res.status === 402 ? "402" : "error";
      recordPoolFailure(String(resolved.model), reason);
    }
    const canSwitchFree = allowSwitch && resolved.provider === "openrouter" && (
      res.status === 402
      || ((res.status === 404 || res.status === 400) && isFree)
      || (res.status === 429 && isFree)
      || (res.status >= 500 && isFree)
    );
    if (canSwitchFree) {
      const next = nextFreeOpenRouter(String(resolved.model), usedFree);
      if (next) {
        console.warn(`openrouter ${res.status} on ${resolved.model}; retrying with ${next}`);
        if (tracker) tracker.model = next;
        return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch);
      }
      console.error(`openrouter ${res.status} on ${resolved.model}; no free fallback left`);
    }
    if (!isFree && isRetryable(res.status) && attempt < maxAttempts) { await sleep(backoffMs(attempt, res.headers.get("retry-after"))); continue; }
    if (isRetryable(res.status)) throw new AiUnavailableError(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    throw new Error(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  throw new AiUnavailableError(`${resolved.provider} request failed`, lastStatus);
}


export type ChatUsage = { provider: string; model: string; credits: number };

type SiteModelOpts = {
  plan?: string | null;
  owner_id?: string | null;
  chat_provider?: string | null;
  chat_model?: string | null;
};

async function resolveForRequest(opts?: {
  primary?: boolean;
  hard?: boolean;
  site?: SiteModelOpts;
}): Promise<{ resolved: ResolvedModel; usage: ChatUsage }> {
  const site = opts?.site;
  const keys = site?.owner_id && isByokPlan(site.plan) ? await loadOwnerKeyMap(site.owner_id) : {};
  let choice = planChatChoice(site, opts?.primary);
  if (isAutoModel(choice?.chat_model)) {
    const available: Partial<Record<string, boolean>> = {};
    for (const id of ["openrouter", "openai", "gemini", "grok"] as ProviderId[]) {
      available[id] = isProviderEnabled(id, keys);
    }
    const picked = pickAutoRoute(available, {
      hard: Boolean(opts?.hard),
      allowPremiumEscalate: isByokPlan(site?.plan),
    });
    choice = { chat_provider: picked.chat_provider, chat_model: picked.chat_model };
  }
  const resolved = resolveChatModel(choice, keys);
  return {
    resolved,
    usage: {
      provider: String(resolved.provider),
      model: resolved.model,
      credits: modelCreditCost(String(resolved.provider), resolved.model),
    },
  };
}

export const _test = { aiFetch, resolveForRequest, nextFreeOpenRouter, clearPaidCreditSkip, rememberPaidCreditsExhausted: rememberPaidCreditsExhausted, raceFreeCompletions };

export async function embedTexts(texts: string[], kind: "query" | "passage" = "passage"): Promise<number[][]> {
  if (!texts.length) return [];
  const resolved = resolveEmbeddingModel();
  const prefix = kind === "query" ? resolved.queryPrefix : resolved.passagePrefix;
  const input = prefix ? texts.map((t) => (t.startsWith(prefix) ? t : prefix + t)) : texts;
  if (resolved.provider === "local" || resolved.provider === "gte-small") {
    return embedInActiveSpace(input);
  }
  const vectors: number[][] = [];
  const batchSize = 32;
  for (let i = 0; i < input.length; i += batchSize) {
    const batch = input.slice(i, i + batchSize);
    const res = await aiFetch(resolved, "/embeddings", {
      model: resolved.model,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of ordered) {
      if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embeddings from ${resolved.provider}/${resolved.model} returned ${row.embedding.length} dimensions; GhostChat requires ${EMBEDDING_DIMENSIONS}.`,
        );
      }
      vectors.push(row.embedding);
    }
  }
  return vectors;
}

function chatBody(model: string, messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number; json?: boolean; fast?: boolean }, stream = false): unknown {
  return {
    model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens ?? 700,
    ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    ...(opts?.fast ? { reasoning: { enabled: false } } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

function readAssistantText(json: { choices?: Array<{ message?: { content?: string } }> }): string {
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Race the two best available free models; the first non-empty reply wins. */
export async function raceFreeCompletions(
  resolved: ResolvedModel,
  models: [string, string],
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean; fast?: boolean } | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ model: string; text: string } | null> {
  const tryOne = async (model: string) => {
    const tracker = { model };
    const res = await aiFetch({ ...resolved, model }, "/chat/completions", chatBody(model, messages, opts), false, fetchImpl, models.filter((m) => m !== model), tracker, false);
    const text = readAssistantText(await res.json() as { choices?: Array<{ message?: { content?: string } }> });
    if (!text) {
      recordPoolFailure(tracker.model, "empty");
      throw new AiUnavailableError(`empty reply from ${tracker.model}`);
    }
    recordPoolSuccess(tracker.model);
    return { model: tracker.model, text };
  };
  const results = await Promise.allSettled([tryOne(models[0]), tryOne(models[1])]);
  for (const r of results) {
    if (r.status === "fulfilled") return r.value;
  }
  return null;
}

export async function completeChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; json?: boolean; fast?: boolean; primary?: boolean; hard?: boolean; site?: SiteModelOpts; usage?: ChatUsage },
): Promise<string> {
  const { resolved, usage } = await resolveForRequest(opts);
  const tracker = { model: resolved.model };
  if (opts?.usage) { opts.usage.provider = usage.provider; opts.usage.model = usage.model; opts.usage.credits = usage.credits; }

  const onFreePath = resolved.provider === "openrouter" && (isFreeOpenRouterModel(resolved.model) || shouldSkipPaidOpenRouter(resolved));
  if (onFreePath) {
    const avail = availableFreeModels();
    if (avail.length >= 2 && !opts?.fast) {
      const raced = await raceFreeCompletions(resolved, [avail[0], avail[1]], messages, opts, fetch);
      if (raced) {
        tracker.model = raced.model;
        if (opts?.usage) {
          opts.usage.model = raced.model;
          opts.usage.credits = modelCreditCost(usage.provider, raced.model);
        }
        return raced.text;
      }
    }
  }

  const used: string[] = [];
  let current = resolved;
  const hops = currentFreePoolIds().length + 2;
  for (let hop = 0; hop < hops; hop++) {
    const res = await aiFetch(current, "/chat/completions", chatBody(current.model, messages, opts), false, fetch, used, tracker);
    if (opts?.usage) {
      opts.usage.model = tracker.model;
      opts.usage.credits = modelCreditCost(usage.provider, tracker.model);
    }
    const text = readAssistantText(await res.json() as { choices?: Array<{ message?: { content?: string } }> });
    if (text) {
      if (isFreeOpenRouterModel(tracker.model)) recordPoolSuccess(tracker.model);
      else console.log(`openrouter answered with ${tracker.model}`);
      return text;
    }
    console.warn(`openrouter empty reply from ${tracker.model}`);
    if (isFreeOpenRouterModel(tracker.model)) recordPoolFailure(tracker.model, "empty");
    used.push(String(tracker.model));
    const next = current.provider === "openrouter" ? nextFreeOpenRouter(String(tracker.model), used) : undefined;
    if (!next) break;
    current = { ...current, model: next };
    tracker.model = next;
  }
  throw new AiUnavailableError(`${resolved.provider} returned an empty reply`);
}

export async function* streamChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; primary?: boolean; hard?: boolean; site?: SiteModelOpts; usage?: ChatUsage },
): AsyncGenerator<string> {
  const { resolved, usage } = await resolveForRequest(opts);
  const tracker = { model: resolved.model };
  if (opts?.usage) { opts.usage.provider = usage.provider; opts.usage.model = usage.model; opts.usage.credits = usage.credits; }
  const res = await aiFetch(
    resolved,
    "/chat/completions",
    {
      model: resolved.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 700,
      stream: true,
    },
    true,
    fetch,
    [],
    tracker,
  );
  if (opts?.usage) {
    opts.usage.model = tracker.model;
    opts.usage.credits = modelCreditCost(usage.provider, tracker.model);
  }
  if (!res.body) throw new AiUnavailableError(`${resolved.provider} did not return a stream`);
  yield* streamOpenRouterAttempt(res.body);
}

type SseDelta = { choices?: Array<{ delta?: { content?: string } }> };

/** Split a provider SSE buffer into complete lines plus any partial tail. `[DONE]` ends the attempt. */
export function pullSseTokens(buffer: string): { rest: string; tokens: string[]; done: boolean } {
  const lines = buffer.split(/\r?\n/);
  let rest = lines.pop() ?? "";
  const tokens: string[] = [];
  let done = false;
  const take = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") { done = true; return; }
    try {
      const token = (JSON.parse(data) as SseDelta).choices?.[0]?.delta?.content;
      if (token) tokens.push(token);
    } catch {
      // ignore partial SSE chunks
    }
  };
  for (const line of lines) {
    take(line);
    if (done) break;
  }
  // A chunk often ends on `data: [DONE]` with no trailing newline. Don't wait for TCP EOF to notice.
  if (!done && /^data:\s*\[DONE\]\s*$/.test(rest.trim())) {
    done = true;
    rest = "";
  }
  return { rest, tokens, done };
}

/**
 * Read one OpenRouter SSE body. Returns as soon as `data: [DONE]` arrives and cancels the reader,
 * instead of blocking until the upstream socket closes.
 */
export async function* streamOpenRouterAttempt(body: ReadableStream<Uint8Array>, idleMs = 20_000): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let idle: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idle = setTimeout(() => {
            reader.cancel().catch(() => {});
            reject(new AiUnavailableError("The AI stream stalled"));
          }, idleMs);
        }),
      ]).finally(() => clearTimeout(idle));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = pullSseTokens(buffer);
      buffer = parsed.rest;
      for (const token of parsed.tokens) yield token;
      if (parsed.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
