import { chatForm, formCard, formMatches, supportCard } from "./forms.js";
import type { ConversionCard, Site } from "../types.js";

const BOOKING_WORDS = /\b(book|booking|schedule|calendly|appointment|demo|call|meeting|availability|slot)\b/i;
const PRODUCT_WORDS = /\b(price|pricing|plan|plans|buy|purchase|product|products|order|upgrade|pro|business)\b/i;
const DISCOUNT_WORDS = /\b(discount|coupon|promo|code|offer|deal|voucher)\b/i;
const FORM_WORDS = /\b(contact|human|email|sales|talk to|get in touch|callback|quote)\b/i;

export function detectBookingProvider(url: string | null | undefined): "cal.com" | "calendly" | "other" | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "cal.com" || host.endsWith(".cal.com")) return "cal.com";
    if (host === "calendly.com" || host.endsWith(".calendly.com")) return "calendly";
    return "other";
  } catch {
    return null;
  }
}

export function normalizeCards(input: unknown, max: number): ConversionCard[] {
  if (!Array.isArray(input)) return [];
  const out: ConversionCard[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const type = String(row.type || "");
    if (!["product", "discount", "form", "booking"].includes(type)) continue;
    const title = String(row.title || "").trim();
    if (!title) continue;
    out.push({
      id: String(row.id || `card_${out.length + 1}`).slice(0, 64),
      type: type as ConversionCard["type"],
      title: title.slice(0, 120),
      subtitle: row.subtitle ? String(row.subtitle).slice(0, 240) : undefined,
      url: row.url ? String(row.url).slice(0, 500) : undefined,
      image: row.image ? String(row.image).slice(0, 500) : undefined,
      price: row.price ? String(row.price).slice(0, 40) : undefined,
      cta: row.cta ? String(row.cta).slice(0, 40) : undefined,
      code: row.code ? String(row.code).slice(0, 80) : undefined,
      triggers: Array.isArray(row.triggers)
        ? row.triggers.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20)
        : undefined,
    });
    if (out.length >= max) break;
  }
  return out;
}

function matchesTriggers(text: string, card: ConversionCard, fallback: RegExp): boolean {
  if (card.triggers?.length) {
    const lower = text.toLowerCase();
    return card.triggers.some((t) => t && lower.includes(t));
  }
  return fallback.test(text);
}

export function selectCards(opts: {
  site: Site;
  message: string;
  answer?: string;
  /** True once the visitor should be offered a human follow-up (2 misses, or asked for a person). */
  handoff?: boolean;
  /** Support mode: offer the ticket form (stuck, asked for a person, or upset). outOfHours carries the owner's message. */
  support?: { offer: boolean; outOfHours: string | null };
}): ConversionCard[] {
  const text = `${opts.message}\n${opts.answer || ""}`;
  const cards = opts.site.conversion_cards ?? [];
  const picked: ConversionCard[] = [];
  const seen = new Set<string>();

  const add = (card: ConversionCard | null | undefined) => {
    if (!card || seen.has(card.id)) return;
    seen.add(card.id);
    picked.push(card);
  };

  for (const card of cards) {
    const kindRe =
      card.type === "product" ? PRODUCT_WORDS :
      card.type === "discount" ? DISCOUNT_WORDS :
      card.type === "form" ? FORM_WORDS :
      BOOKING_WORDS;
    if (matchesTriggers(text, card, kindRe) || (opts.handoff && card.type === "form")) {
      add(card);
    }
  }

  if ((BOOKING_WORDS.test(text) || !picked.some((c) => c.type === "booking")) && opts.site.booking_url && BOOKING_WORDS.test(text)) {
    add({
      id: "booking-default",
      type: "booking",
      title: "Book a time",
      subtitle: "Pick a slot that works for you.",
      url: opts.site.booking_url,
      cta: "Open calendar",
    });
  }

  if (opts.support?.offer) add(supportCard(opts.support.outOfHours));
  const form = chatForm(opts.site);
  if (!picked.some((c) => c.type === "form") && (formMatches(form, opts.message) || (opts.handoff && form.enabled))) add(formCard(form));

  if (opts.handoff && !picked.some((c) => c.type === "form")) {
    add({
      id: "form-default",
      type: "form",
      title: "Want a human to follow up?",
      subtitle: "Leave your email and the team can continue this conversation.",
      cta: "Send",
    });
  }

  return picked.slice(0, 3);
}
