import assert from "node:assert/strict";
import { test } from "node:test";
import { detectBookingProvider, selectCards, normalizeCards } from "../server/src/lib/cards.ts";
import type { Site } from "../server/src/types.ts";

function site(partial: Partial<Site>): Site {
  return {
    id: "s1",
    owner_id: "o1",
    name: "Demo",
    url: "https://example.com",
    site_key: "gc_test",
    theme: { mode: "dark", primary: "#a78bfa" },
    greeting: null,
    persona: null,
    tone: "friendly",
    guardrails: null,
    banned_topics: [],
    starter_questions: [],
    proactive_delay_ms: 4000,
    sound_default: false,
    show_branding: true,
    plan: "free",
    messages_this_period: 0,
    leads_this_period: 0,
    period_start: new Date().toISOString(),
    crawl_status: "idle",
    crawl_error: null,
    last_crawled_at: null,
    page_count: 0,
    chunk_count: 0,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

test("detects Cal.com and Calendly booking providers", () => {
  assert.equal(detectBookingProvider("https://cal.com/zane/intro"), "cal.com");
  assert.equal(detectBookingProvider("https://calendly.com/zane/30min"), "calendly");
  assert.equal(detectBookingProvider("https://example.com/book"), "other");
});

test("selects a booking card when the visitor asks to schedule", () => {
  const cards = selectCards({
    site: site({ booking_url: "https://cal.com/zane/intro" }),
    message: "Can I book a demo for next week?",
  });
  assert.ok(cards.some((c) => c.type === "booking" && c.url?.includes("cal.com")));
});

test("normalizes and caps conversion cards", () => {
  const out = normalizeCards([{ type: "discount", title: "Launch offer", code: "GHOST10" }, { type: "nope", title: "x" }], 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "GHOST10");
});
