/** Live pool of free OpenRouter chat models, ranked best-first, with cooldowns. */
export const FREE_POOL_SIZE = 10;
export const FREE_MODEL_TIMEOUT_MS = Number(process.env.FREE_MODEL_TIMEOUT_MS) || 10_000;
export const FREE_POOL_REFRESH_MS = Number(process.env.FREE_POOL_REFRESH_MS) || 60 * 60 * 1000;
/** Transient failures (429, timeout, empty, 402) cool off briefly so one bad minute can't wipe the pool. */
const TRANSIENT_COOLDOWN_MS = [60_000, 120_000, 180_000];
/** A real 400 (bad request) backs off a few minutes. Reasoning-mandatory 400s are not recorded as failures. */
const BAD_REQUEST_COOLDOWN_MS = 3 * 60_000;
const NOT_FOUND_COOLDOWN_MS = 60 * 60_000;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Hand-ranked preference, best first, for site-assistant answers.
 * Live catalog filters this; models that 404 or aren't listed are dropped.
 * `openrouter/free` is a late fallback router, not a first pick (it often returns empty).
 */
export const PREFERRED_FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-3.2-flash:free",
  "dots-studio/dots-3-note-preview:free",
  "liquid/lfm-3-1.7b:free",
  "particle-ai/particle-1:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "baidu/ernie-5.5-flash-preview:free",
  "recursive/flint-v1.0:free",
  "openrouter/free",
  "nvidia/nemotron-3.5-super-vl:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "cohere/north-mini-code:free",
];

/** @deprecated Use PREFERRED_FREE_MODELS / currentFreePoolIds(). Kept as an alias for older tests. */
export const FREE_OPENROUTER_FALLBACKS = PREFERRED_FREE_MODELS;
export const FREE_OPENROUTER_FALLBACK = PREFERRED_FREE_MODELS[0];

export type OpenRouterModelRow = {
  id?: string;
  name?: string;
  architecture?: { modality?: string; output_modalities?: string[] };
  pricing?: { prompt?: string | number; completion?: string | number };
};

export function isFreeChatModel(row: OpenRouterModelRow): boolean {
  const id = String(row.id || "");
  if (!id) return false;
  // Lyria and other non-chat previews sometimes show $0 pricing; only take :free chat ids (plus the official router).
  if (id === "openrouter/free" || id.endsWith(":free")) return true;
  return false;
}

export function rankFreeModels(liveIds: string[], preferred: string[] = PREFERRED_FREE_MODELS, size = FREE_POOL_SIZE): string[] {
  const live = new Set(liveIds);
  const out: string[] = [];
  const push = (id: string) => {
    if (!id || out.includes(id)) return;
    // The official router is always eligible even if the catalog omits it.
    if (id !== "openrouter/free" && live.size && !live.has(id)) return;
    out.push(id);
  };
  for (const id of preferred) {
    push(id);
    if (out.length >= size) return out;
  }
  for (const id of liveIds) {
    push(id);
    if (out.length >= size) return out;
  }
  return out;
}

export type PoolFailureReason = "429" | "404" | "400" | "empty" | "timeout" | "error" | "402";

export type PoolMemberHealth = {
  id: string;
  cooling: boolean;
  cooldownUntil: number | null;
  failCount: number;
  lastError: string | null;
  lastSuccessAt: number | null;
};

export type PoolHealth = {
  refreshedAt: number | null;
  refreshError: string | null;
  liveCount: number;
  pool: string[];
  members: PoolMemberHealth[];
  lastAnswered: { model: string; at: number } | null;
};

type Member = { cooldownUntil: number; failCount: number; lastError: string | null; lastSuccessAt: number | null };

let poolIds: string[] = PREFERRED_FREE_MODELS.slice(0, FREE_POOL_SIZE);
let liveIds: string[] = [];
let refreshedAt: number | null = null;
let refreshError: string | null = null;
let lastAnswered: { model: string; at: number } | null = null;
const members = new Map<string, Member>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function member(id: string): Member {
  let m = members.get(id);
  if (!m) {
    m = { cooldownUntil: 0, failCount: 0, lastError: null, lastSuccessAt: null };
    members.set(id, m);
  }
  return m;
}

export function isCooling(id: string, now = Date.now()): boolean {
  return member(id).cooldownUntil > now;
}

export function currentFreePoolIds(): string[] {
  return poolIds.slice();
}

export function availableFreeModels(used: string[] = [], now = Date.now()): string[] {
  const skip = new Set(used);
  return currentFreePoolIds().filter((id) => !skip.has(id) && !isCooling(id, now));
}

export function nextFreeInPool(current: string, used: string[] = [], now = Date.now()): string | undefined {
  const skip = new Set([...used, current]);
  return availableFreeModels([], now).find((id) => !skip.has(id));
}

/**
 * When every free model is cooling, try the last model that actually answered,
 * otherwise the one whose cooldown ends soonest. One rescue per request — callers
 * pass models already tried in `used`.
 */
export function bestEffortFreeModel(used: string[] = [], now = Date.now()): string | undefined {
  const ready = availableFreeModels(used, now);
  if (ready.length) return ready[0];
  const skip = new Set(used);
  const pool = currentFreePoolIds().filter((id) => !skip.has(id));
  if (!pool.length) return undefined;
  if (lastAnswered && pool.includes(lastAnswered.model)) return lastAnswered.model;
  return pool.slice().sort((a, b) => member(a).cooldownUntil - member(b).cooldownUntil)[0];
}

export function recordPoolSuccess(id: string, now = Date.now()): void {
  const m = member(id);
  m.failCount = 0;
  m.cooldownUntil = 0;
  m.lastError = null;
  m.lastSuccessAt = now;
  lastAnswered = { model: id, at: now };
  console.log(`openrouter pool answered with ${id}`);
}

export function recordPoolFailure(id: string, reason: PoolFailureReason, now = Date.now()): void {
  const m = member(id);
  m.failCount += 1;
  m.lastError = reason;
  const ms = reason === "404"
    ? NOT_FOUND_COOLDOWN_MS
    : reason === "400"
      ? BAD_REQUEST_COOLDOWN_MS
      : TRANSIENT_COOLDOWN_MS[Math.min(m.failCount - 1, TRANSIENT_COOLDOWN_MS.length - 1)];
  m.cooldownUntil = now + ms;
  console.warn(`openrouter pool cooldown ${id} for ${Math.round(ms / 1000)}s after ${reason}`);
}

export function clearPoolState(): void {
  members.clear();
  lastAnswered = null;
  refreshError = null;
}

export function setPoolForTests(ids: string[]): void {
  poolIds = ids.slice();
  liveIds = ids.slice();
  refreshedAt = Date.now();
  refreshError = null;
}

export function poolHealth(now = Date.now()): PoolHealth {
  return {
    refreshedAt,
    refreshError,
    liveCount: liveIds.length,
    pool: currentFreePoolIds(),
    members: currentFreePoolIds().map((id) => {
      const m = member(id);
      return {
        id,
        cooling: m.cooldownUntil > now,
        cooldownUntil: m.cooldownUntil > now ? m.cooldownUntil : null,
        failCount: m.failCount,
        lastError: m.lastError,
        lastSuccessAt: m.lastSuccessAt,
      };
    }),
    lastAnswered,
  };
}

export function extractFreeModelIds(rows: OpenRouterModelRow[]): string[] {
  return rows.filter(isFreeChatModel).map((r) => String(r.id));
}

export async function refreshFreeModelPool(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`models list HTTP ${res.status}`);
    const json = (await res.json()) as { data?: OpenRouterModelRow[] };
    const rows = Array.isArray(json.data) ? json.data : [];
    liveIds = extractFreeModelIds(rows);
    poolIds = rankFreeModels(liveIds);
    refreshedAt = Date.now();
    refreshError = null;
    console.log(`openrouter free pool (${poolIds.length}): ${poolIds.join(", ")}`);
    return poolIds;
  } catch (err) {
    refreshError = (err as Error).message;
    console.warn("openrouter free pool refresh failed:", refreshError);
    // Keep the last good pool, or the preference list if we've never succeeded.
    if (!refreshedAt) poolIds = PREFERRED_FREE_MODELS.slice(0, FREE_POOL_SIZE);
    return poolIds;
  }
}

export function startFreeModelPool(): void {
  if (process.env.NODE_ENV === "test") return;
  refreshFreeModelPool().catch(() => {});
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refreshFreeModelPool().catch(() => {}); }, FREE_POOL_REFRESH_MS);
  if (typeof refreshTimer.unref === "function") refreshTimer.unref();
}
