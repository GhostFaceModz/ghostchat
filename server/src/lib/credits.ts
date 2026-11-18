/** Model-weighted message credits: 1 / 2 / 3 / 5. */
export type CreditCost = 1 | 2 | 3 | 5;

const FREE = /(?::free$|^openrouter\/free$|gemma|nemotron)/i;

export function modelCreditCost(provider?: string | null, model?: string | null): CreditCost {
  const p = (provider || "").toLowerCase();
  const m = (model || "").toLowerCase().trim();
  if (!m || m === "auto") return 1;
  if (FREE.test(m) || m.includes("deepseek-v4-flash") || m.includes("deepseek/deepseek-v4-flash")) return 1;
  // Cheap defaults stay 1 credit.
  if (/\bgpt-4o-mini\b/.test(m) || m.endsWith("/gpt-4o-mini") || m === "gpt-4o-mini") return 1;
  if (/gemini-2\.5-flash|gemini-2\.0-flash/.test(m)) return 1;
  // Haiku
  if (/haiku/.test(m)) return 2;
  // Flagship
  if (/opus|\bo1\b|\bo3\b|gpt-4\.1(?!-mini)|gpt-4(?!o)|claude-3-opus|gpt-5(?!-|o-mini)|claude-4\.5-opus/.test(m) && !/mini|flash|haiku|nano/.test(m)) return 5;
  if (/(?:^|\/)gpt-4(?:$|[^o])/.test(m) && !/mini|nano/.test(m)) return 5;
  // Mid: Sonnet, GPT-4o (full), Gemini Pro, Grok, GPT-4.1-mini
  if (/sonnet|gpt-4o$|gpt-4o(?!-mini)|gpt-4\.1-mini|gemini-2\.5-pro|gemini-1\.5-pro|grok/.test(m)) return 3;
  if (p === "grok") return 3;
  // Unknown paid mid-tier models default to 3 so a new flagship cannot sneak through as 1.
  if (!FREE.test(m) && !/flash|mini|nano|haiku|deepseek/.test(m)) return 3;
  return 1;
}

export function creditLabel(cost: CreditCost): string {
  return cost === 1 ? "1 credit / reply" : `${cost} credits / reply`;
}
