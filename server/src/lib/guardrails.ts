/** Prompt-injection and banned-topic checks. */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the|previous|prior|above) (instructions|rules|prompts)/i,
  /disregard (all|any|the|previous|prior|above) (instructions|rules|prompts)/i,
  /you are now /i,
  /\bsystem\s*(prompt|override|role)\b/i,
  /\bjailbreak\b/i,
  /pretend (you are|to be) (an? )?(unrestricted|uncensored|evil|dan)\b/i,
  /reveal (your )?(system|hidden|secret) (prompt|instructions)/i,
  /override (your )?(safety|guard|instructions)/i,
  /<\|?(system|im_start|endofprompt)\|?>/i,
];

export type InjectionResult = {
  flagged: boolean;
  reason?: string;
};

export function detectInjection(text: string): InjectionResult {
  const trimmed = (text || "").trim();
  if (!trimmed) return { flagged: false };
  for (const re of INJECTION_PATTERNS) {
    if (re.test(trimmed)) {
      return { flagged: true, reason: "prompt_injection" };
    }
  }
  return { flagged: false };
}

export function hitsBannedTopic(text: string, banned: string[] | null | undefined): string | null {
  if (!banned?.length) return null;
  const lower = text.toLowerCase();
  for (const raw of banned) {
    const topic = raw.trim().toLowerCase();
    if (topic.length < 2) continue;
    if (lower.includes(topic)) return raw.trim();
  }
  return null;
}

export function sanitizeContext(text: string): string {
  // Neutralize instruction-like lines inside retrieved site content.
  return text
    .replace(/^\s*(system|assistant|instruction)\s*:/gim, "content:")
    .replace(/ignore (all|any|previous) instructions/gi, "[filtered]");
}

export const UNSURE_REPLY =
  "I'm not sure — I couldn't find that on this site, so I'd rather not guess. Try asking about the product, pricing or setup, or rephrase your question and I'll try again.";

/** The visitor explicitly wants a person. */
export const HUMAN_REQUEST = /\b(human|real person|live (agent|person|chat)|(speak|talk|chat) (to|with) (a |an |the )?(person|someone|agent|team|support|staff|owner)|customer (service|support)|contact (support|the team|you|someone)|email (support|the team)|call me|get in touch)\b/i;
