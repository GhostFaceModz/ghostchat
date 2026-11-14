/** Bot modes (Assistant / Support / Sales / Recommendations), the support playbook and support hours. */
import type { Site } from "../types.js";

export type BotMode = "assistant" | "support" | "sales" | "recommendations";
export const BOT_MODES: BotMode[] = ["assistant", "support", "sales", "recommendations"];

export type SupportSettings = {
  hours: { enabled: boolean; tz: string; days: number[]; start: string; end: string };
  out_of_hours_message: string;
  canned: Array<{ title: string; text: string }>;
  quick_replies: string[];
  csat: "thumbs" | "stars";
  greeting: string;
};

export const DEFAULT_SUPPORT: SupportSettings = {
  hours: { enabled: false, tz: "Europe/London", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  out_of_hours_message: "Our team is offline right now. I can still help, or leave your details and we'll get back to you when we're back.",
  canned: [],
  quick_replies: ["Track my order", "Report a problem", "Talk to a human"],
  csat: "stars",
  greeting: "Hi! I'm here to help. What's going wrong?",
};

export function botMode(site: Pick<Site, "bot_mode">): BotMode {
  return BOT_MODES.includes(site.bot_mode as BotMode) ? (site.bot_mode as BotMode) : "assistant";
}

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const hhmm = (v: unknown, d: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d);

export function normalizeSupport(input: unknown, current?: unknown): SupportSettings {
  const cur = supportSettings({ support: current as Record<string, unknown> });
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const h = (raw.hours && typeof raw.hours === "object" ? raw.hours : {}) as Record<string, unknown>;
  let tz = clip(h.tz ?? cur.hours.tz, 60) || "Europe/London";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "Europe/London"; }
  return {
    hours: {
      enabled: typeof h.enabled === "boolean" ? h.enabled : cur.hours.enabled,
      tz,
      days: Array.isArray(h.days) ? [...new Set(h.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : cur.hours.days,
      start: hhmm(h.start, cur.hours.start),
      end: hhmm(h.end, cur.hours.end),
    },
    out_of_hours_message: raw.out_of_hours_message !== undefined ? clip(raw.out_of_hours_message, 500) : cur.out_of_hours_message,
    canned: Array.isArray(raw.canned)
      ? raw.canned.map((c) => ({ title: clip((c as Record<string, unknown>)?.title, 60), text: clip((c as Record<string, unknown>)?.text, 1500) })).filter((c) => c.title && c.text).slice(0, 30)
      : cur.canned,
    quick_replies: Array.isArray(raw.quick_replies) ? raw.quick_replies.map((q) => clip(q, 60)).filter(Boolean).slice(0, 6) : cur.quick_replies,
    csat: raw.csat === "thumbs" || raw.csat === "stars" ? raw.csat : cur.csat,
    greeting: raw.greeting !== undefined ? clip(raw.greeting, 300) : cur.greeting,
  };
}

export function supportSettings(site: Pick<Site, "support">): SupportSettings {
  const s = (site.support || {}) as Partial<SupportSettings>;
  return {
    ...DEFAULT_SUPPORT,
    ...s,
    hours: { ...DEFAULT_SUPPORT.hours, ...(s.hours || {}) },
    canned: Array.isArray(s.canned) ? s.canned : [],
    quick_replies: Array.isArray(s.quick_replies) ? s.quick_replies : DEFAULT_SUPPORT.quick_replies,
  };
}

/** Is the support team in hours right now (owner's time zone)? Always true when hours are off. */
export function withinSupportHours(s: SupportSettings, now = new Date()): boolean {
  if (!s.hours.enabled) return true;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: s.hours.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const start = toMin(s.hours.start), end = toMin(s.hours.end);
  if (!s.hours.days.includes(day)) return false;
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end; // overnight shifts
}

const ANGER = /\b(furious|angry|livid|fuming|ridiculous|unacceptable|useless|worst|scam|disgusting|pathetic|rubbish|joke|terrible|awful|hate|sue|lawyer|chargeback|refund (me )?now|wtf|f+u+c+k\w*|shit\w*|crap|bullshit)\b/i;
/** Visible frustration: strong words, lots of exclamation marks, or shouting in capitals. */
export function detectAnger(text: string): boolean {
  const t = String(text || "");
  if (ANGER.test(t)) return true;
  if (/!{3,}/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 12 && letters === letters.toUpperCase();
}

export function ticketPriority(text: string): "low" | "normal" | "high" | "urgent" {
  if (detectAnger(text)) return "urgent";
  if (/\b(urgent|asap|immediately|can't log ?in|cannot log ?in|charged twice|double charged|not working|broken|down|outage|refund)\b/i.test(text)) return "high";
  return "normal";
}

export function modePlaybook(site: Pick<Site, "bot_mode" | "support" | "name">, now = new Date()): string {
  const mode = botMode(site);
  if (mode === "support") {
    const s = supportSettings(site);
    const canned = s.canned.slice(0, 10).map((c) => `  • ${c.title}: ${c.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const hours = withinSupportHours(s, now) ? "The support team is in hours." : `The support team is OUT OF HOURS. If a human is needed, say: "${s.out_of_hours_message}"`;
    return `
SUPPORT PLAYBOOK (you are ${site.name}'s customer support assistant):
- If the visitor hasn't said what's wrong yet, greet them briefly and ask what's going wrong.
- Troubleshoot step by step from the CONTEXT: give one or two steps at a time, numbered, then ask whether that fixed it. Don't dump every step at once.
- Ask for an order number, account email or name only when you actually need it, and never ask for passwords, full card numbers or security codes.
- If you're stuck, the visitor asks for a person, or they're upset, apologise briefly and say you can pass this to the team; the chat will show a form or connect them.
- Offer to have the team follow up by email when something can't be solved in chat.
- When it looks solved, ask if there's anything else and thank them.
- ${hours}${canned ? `\n- Owner-approved replies you may reuse when they fit:\n${canned}` : ""}`;
  }
  if (mode === "sales") {
    return `
SALES PLAYBOOK: Understand what the visitor needs with at most one short question, then recommend the best-fitting plan or product from the CONTEXT with a one-line reason and a clear next step (a link, the booking link, or leaving their email). Be warm and never pushy. Never invent prices, discounts or guarantees.`;
  }
  if (mode === "recommendations") {
    return `
RECOMMENDATIONS PLAYBOOK: If the request is vague, ask one short question about taste or needs. Otherwise suggest up to 3 options with a short reason each, preferring items from the CONTEXT and linking their pages.`;
  }
  return "";
}
