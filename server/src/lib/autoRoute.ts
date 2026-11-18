/** Auto route: stay on the cheap/free default, escalate only hard questions. */
import { DEFAULT_CHAT_MODEL, DEFAULT_CHAT_PROVIDER, type ProviderId } from "./models.js";
import type { RetrievedChunk } from "../types.js";

export const AUTO_MODEL_ID = "auto";

const HARD = /\b(compare|versus|vs\.?|analyse|analyze|explain in detail|step by step|why does|walk me through|difference between|legal|policy|debug|architect)\b/i;

export function isAutoModel(model?: string | null): boolean {
  return !model || model === AUTO_MODEL_ID;
}

export function looksHardQuestion(message: string, chunks: RetrievedChunk[] = [], opts?: { lookedUp?: boolean; previousUnsure?: boolean }): boolean {
  const q = (message || "").trim();
  if (opts?.lookedUp || opts?.previousUnsure) return true;
  if (q.length >= 280) return true;
  if (HARD.test(q)) return true;
  if (chunks.length) {
    const best = Math.max(0, ...chunks.map((c) => Number(c.similarity) || 0));
    if (best > 0 && best < 0.45) return true;
  }
  return false;
}

export type RouteChoice = { chat_provider: ProviderId | string; chat_model: string; escalated: boolean };

const CHEAP_ESCALATIONS: Array<{ provider: ProviderId; model: string }> = [
  { provider: "openrouter", model: "openai/gpt-4o-mini" },
  { provider: "openrouter", model: "google/gemini-2.5-flash" },
  { provider: "openai", model: "gpt-4o-mini" },
];

/** Cheap default, or a 1-credit stronger model when the question looks hard and a key exists. */
export function pickAutoRoute(
  available: Partial<Record<string, boolean | string>>,
  opts?: { hard?: boolean; allowPremiumEscalate?: boolean },
): RouteChoice {
  const has = (provider: string) => Boolean(available[provider]);
  const defaultChoice: RouteChoice = { chat_provider: DEFAULT_CHAT_PROVIDER, chat_model: DEFAULT_CHAT_MODEL, escalated: false };
  if (!opts?.hard) return defaultChoice;
  for (const opt of CHEAP_ESCALATIONS) {
    if (!has(opt.provider)) continue;
    if (opt.model === DEFAULT_CHAT_MODEL) continue;
    return { chat_provider: opt.provider, chat_model: opt.model, escalated: true };
  }
  return defaultChoice;
}
