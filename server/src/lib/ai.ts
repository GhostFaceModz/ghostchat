import { EMBEDDING_DIMENSIONS, planChatChoice, resolveChatModel, resolveEmbeddingModel, isProviderEnabled, type ProviderId, type ResolvedModel } from "./models.js";
import { loadOwnerKeyMap, isByokPlan } from "./byok.js";
import { isAutoModel, pickAutoRoute } from "./autoRoute.js";
import { modelCreditCost } from "./credits.js";
import {
  FREE_MODEL_TIMEOUT_MS,
  availableFreeModels,
  bestEffortFreeModel,
  currentFreePoolIds,
  nextFreeInPool,
  recordPoolFailure,
  recordPoolSuccess,
  type PoolFailureReason,
} from "./freeModelPool.js";
import { embedInActiveSpace } from "./embeddingSpace.js";

export { FREE_OPENROUTER_FALLBACK, FREE_OPENROUTER_FALLBACKS, poolHealth, startFreeModelPool, refreshFreeModelPool } from "./freeModelPool.js";

export function isFreeOpenRouterModel(model: string): boolean {
  return model.endsWith(":free") || model === "openrouter/free";
}

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

/** Models that reject `reasoning: { enabled: false }`. Remembered so the next call doesn't disable it. */
const reasoningRequired = new Set<string>();
export function markReasoningRequired(model: string): void {
  if (model) reasoningRequired.add(model);
}
export function clearReasoningRequired(): void {
  reasoningRequired.clear();
}
export function modelRequiresReasoning(model: string): boolean {
  return reasoningRequired.has(model);
}

/** Families that spend the token budget on chain-of-thought or refuse to disable it. */
const REASONING_FAMILY = /nemotron|ernie|flint|reasoning|qwq|deepseek-r1/i;

/** Backoff before retry n (0-based): ~0.6s then ~1.8s, honouring Retry-After up to 5s. */
export function backoffMs(attempt: number, retryAfter?: string | null): number {
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.min(5000, ra * 1000);
  return Math.round(600 * Math.pow(3, attempt) * (0.8 + Math.random() * 0.4));
}
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

type FailoverState = { rescued: boolean };

function takeNextFree(current: string, used: string[], state: FailoverState): string | undefined {
  const next = nextFreeInPool(current, used);
  if (next) return next;
  if (state.rescued) return undefined;
  const rescue = bestEffortFreeModel([...used, current]);
  if (!rescue || rescue === current) return undefined;
  state.rescued = true;
  return rescue;
}

function withModel(body: unknown, model: string): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) return { ...(body as Record<string, unknown>), model };
  return body;
}

export function isReasoningMandatoryError(status: number, text: string): boolean {
  return status === 400 && /reasoning is mandatory|cannot be disabled/i.test(text);
}

function disablesReasoning(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const reasoning = (body as { reasoning?: { enabled?: boolean } }).reasoning;
  return Boolean(reasoning && reasoning.enabled === false);
}

function withReasoningEnabled(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const next = { ...(body as Record<string, unknown>) };
  const max = Number(next.max_tokens) || 700;
  next.max_tokens = Math.max(max + 800, 1200);
  next.reasoning = { enabled: true, exclude: true, max_tokens: 512 };
  return next;
}

async function aiFetch(
  resolved: ResolvedModel,
  path: string,
  body: unknown,
  stream = false,
  fetchImpl: typeof fetch = fetch,
  usedFree: string[] = [],
  tracker?: { model: string },
  allowSwitch = true,
  state?: FailoverState,
): Promise<Response> {
  const failover = state ?? { rescued: false };
  if (tracker) tracker.model = String(resolved.model);
  if (!resolved.apiKey) {
    throw new Error(`No API key is configured for ${resolved.provider}.`);
  }
  if (allowSwitch && shouldSkipPaidOpenRouter(resolved)) {
    const next = takeNextFree(String(resolved.model), usedFree, failover) || availableFreeModels(usedFree)[0];
    if (next) {
      console.warn(`openrouter paid credits recently exhausted; starting with ${next}`);
      if (tracker) tracker.model = next;
      return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch, failover);
    }
    throw new AiUnavailableError("OpenRouter paid credits are exhausted and every free model is cooling");
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
      const next = allowSwitch && resolved.provider === "openrouter" ? takeNextFree(String(resolved.model), usedFree, failover) : undefined;
      if (next) {
        console.warn(`openrouter ${reason} on ${resolved.model}; retrying with ${next}`);
        if (tracker) tracker.model = next;
        return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch, failover);
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
    if (isReasoningMandatoryError(res.status, text) && disablesReasoning(body)) {
      markReasoningRequired(String(resolved.model));
      console.warn(`openrouter reasoning mandatory on ${resolved.model}; retrying without disabling reasoning`);
      return aiFetch(resolved, path, withReasoningEnabled(body), stream, fetchImpl, usedFree, tracker, allowSwitch, failover);
    }
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
      const next = takeNextFree(String(resolved.model), usedFree, failover);
      if (next) {
        console.warn(`openrouter ${res.status} on ${resolved.model}; retrying with ${next}`);
        if (tracker) tracker.model = next;
        return aiFetch({ ...resolved, model: next }, path, withModel(body, next), stream, fetchImpl, [...usedFree, String(resolved.model)], tracker, allowSwitch, failover);
      }
      if (shouldSkipPaidOpenRouter({ ...resolved, model: "paid" }) || (res.status === 402 && !isFree)) {
        throw new AiUnavailableError(`${resolved.provider} request failed (${res.status}): ${text.slice(0, 200)}`, res.status);
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

export const _test = {
  aiFetch,
  resolveForRequest,
  nextFreeOpenRouter: (current: string, used: string[]) => nextFreeInPool(current, used),
  clearPaidCreditSkip,
  rememberPaidCreditsExhausted,
  raceFreeCompletions,
  chatBody,
  readAssistantPayload,
  markReasoningRequired,
  clearReasoningRequired,
  streamResolvedChat,
};

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

type ChatOpts = { maxTokens?: number; temperature?: number; json?: boolean; fast?: boolean };

export function chatBody(model: string, messages: ChatMessage[], opts?: ChatOpts, stream = false): Record<string, unknown> {
  const family = REASONING_FAMILY.test(model) || reasoningRequired.has(model);
  const disable = Boolean(opts?.fast) && !family;
  let maxTokens = opts?.maxTokens ?? 700;
  if (family) maxTokens = Math.max(maxTokens + 800, 1200);
  return {
    model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: maxTokens,
    ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    ...(disable ? { reasoning: { enabled: false } } : {}),
    ...(family ? { reasoning: { enabled: true, exclude: true, max_tokens: 512 } } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

/** Visible answer text only. Reasoning / chain-of-thought is never returned. */
export function visibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const row = part as Record<string, unknown>;
    if (/reason|think/i.test(String(row.type || ""))) return "";
    if (typeof row.text === "string") return row.text;
    if (typeof row.content === "string") return row.content;
    return "";
  }).join("");
}

export function readAssistantPayload(json: unknown): { text: string; reasoningOnly: boolean } {
  const message = (json as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message ?? {};
  const text = visibleText(message.content).trim();
  const reasoning = visibleText(message.reasoning).trim()
    || (typeof message.reasoning === "string" ? message.reasoning.trim() : "")
    || (typeof message.reasoning_content === "string" ? message.reasoning_content.trim() : "");
  return { text, reasoningOnly: !text && Boolean(reasoning) };
}

/** Race the two best available free models; the first non-empty reply wins. Not used on the hot path (it spends two free-tier calls). */
export async function raceFreeCompletions(
  resolved: ResolvedModel,
  models: [string, string],
  messages: ChatMessage[],
  opts: ChatOpts | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ model: string; text: string } | null> {
  const tryOne = async (model: string) => {
    const tracker = { model };
    const res = await aiFetch({ ...resolved, model }, "/chat/completions", chatBody(model, messages, opts), false, fetchImpl, models.filter((m) => m !== model), tracker, false);
    const text = readAssistantPayload(await res.json()).text;
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
  opts?: ChatOpts & { primary?: boolean; hard?: boolean; site?: SiteModelOpts; usage?: ChatUsage },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { resolved, usage } = await resolveForRequest(opts);
  const tracker = { model: resolved.model };
  if (opts?.usage) { opts.usage.provider = usage.provider; opts.usage.model = usage.model; opts.usage.credits = usage.credits; }

  const used: string[] = [];
  let current = resolved;
  const failover: FailoverState = { rescued: false };
  const reasoningRetried = new Set<string>();
  const hops = currentFreePoolIds().length + 3;
  for (let hop = 0; hop < hops; hop++) {
    const res = await aiFetch(current, "/chat/completions", chatBody(current.model, messages, opts), false, fetchImpl, used, tracker, true, failover);
    if (opts?.usage) {
      opts.usage.model = tracker.model;
      opts.usage.credits = modelCreditCost(usage.provider, tracker.model);
    }
    const payload = readAssistantPayload(await res.json());
    if (payload.text) {
      if (isFreeOpenRouterModel(tracker.model)) recordPoolSuccess(tracker.model);
      else console.log(`openrouter answered with ${tracker.model}`);
      return payload.text;
    }
    if (payload.reasoningOnly && !reasoningRetried.has(tracker.model)) {
      reasoningRetried.add(tracker.model);
      markReasoningRequired(tracker.model);
      current = { ...current, model: tracker.model };
      console.warn(`openrouter reasoning-only reply from ${tracker.model}; retrying with more room`);
      continue;
    }
    console.warn(`openrouter empty reply from ${tracker.model}`);
    if (isFreeOpenRouterModel(tracker.model)) recordPoolFailure(tracker.model, "empty");
    used.push(String(tracker.model));
    const next = current.provider === "openrouter" ? takeNextFree(String(tracker.model), used, failover) : undefined;
    if (!next) break;
    current = { ...current, model: next };
    tracker.model = next;
  }
  throw new AiUnavailableError(`${resolved.provider} returned an empty reply`);
}

function deltaText(delta: { content?: unknown } | undefined): string {
  return visibleText(delta?.content);
}

async function* readSseContent(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const IDLE_MS = 12_000;
  while (true) {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => { idle = setTimeout(() => { reader.cancel().catch(() => {}); reject(new AiUnavailableError("The AI stream stalled")); }, IDLE_MS); }),
    ]).finally(() => clearTimeout(idle));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
        const token = deltaText(json.choices?.[0]?.delta);
        if (token) yield token;
      } catch {
        // ignore partial SSE chunks
      }
    }
  }
}

/** Hop across free models until one produces visible text, then stream it. Nothing is yielded before that. */
export async function* streamResolvedChat(
  resolved: ResolvedModel,
  messages: ChatMessage[],
  opts: ChatOpts | undefined,
  fetchImpl: typeof fetch,
  onModel?: (model: string) => void,
): AsyncGenerator<string> {
  const tracker = { model: resolved.model };
  const used: string[] = [];
  let current = resolved;
  const failover: FailoverState = { rescued: false };
  const hops = currentFreePoolIds().length + 3;
  for (let hop = 0; hop < hops; hop++) {
    let res: Response;
    try {
      res = await aiFetch(current, "/chat/completions", chatBody(current.model, messages, opts, true), true, fetchImpl, used, tracker, true, failover);
    } catch (err) {
      if (hop === 0) throw err;
      break;
    }
    onModel?.(tracker.model);
    let produced = "";
    try {
      for await (const token of readSseContent(res)) {
        produced += token;
        yield token;
      }
    } catch (err) {
      if (produced) throw err;
      console.warn(`openrouter stream failed on ${tracker.model}: ${(err as Error).message}`);
    }
    if (produced.trim()) {
      if (isFreeOpenRouterModel(tracker.model)) recordPoolSuccess(tracker.model);
      return;
    }
    console.warn(`openrouter empty stream from ${tracker.model}`);
    if (isFreeOpenRouterModel(tracker.model)) recordPoolFailure(tracker.model, "empty");
    used.push(String(tracker.model));
    const next = current.provider === "openrouter" ? takeNextFree(String(tracker.model), used, failover) : undefined;
    if (!next) break;
    current = { ...current, model: next };
    tracker.model = next;
  }
  throw new AiUnavailableError(`${resolved.provider} returned an empty reply`);
}

export async function* streamChat(
  messages: ChatMessage[],
  opts?: ChatOpts & { primary?: boolean; hard?: boolean; site?: SiteModelOpts; usage?: ChatUsage },
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<string> {
  const { resolved, usage } = await resolveForRequest(opts);
  if (opts?.usage) { opts.usage.provider = usage.provider; opts.usage.model = usage.model; opts.usage.credits = usage.credits; }
  yield* streamResolvedChat(resolved, messages, opts, fetchImpl, (model) => {
    if (!opts?.usage) return;
    opts.usage.model = model;
    opts.usage.credits = modelCreditCost(usage.provider, model);
  });
}
