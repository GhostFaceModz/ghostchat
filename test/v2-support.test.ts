import { test } from "node:test";
import assert from "node:assert/strict";
import { botMode, normalizeSupport, supportSettings, withinSupportHours, detectAnger, ticketPriority, modePlaybook, DEFAULT_SUPPORT } from "../server/src/lib/modes.js";
import { normalizeChatForm, validateSubmission, formMatches, chatForm, SUPPORT_FORM_FIELDS, submissionNotes } from "../server/src/lib/forms.js";
import { selectCards } from "../server/src/lib/cards.js";
import { higherPriority, ticketSubject } from "../server/src/lib/tickets.js";
import { buildSystemPrompt } from "../server/src/lib/chat.js";
import type { Site } from "../server/src/types.js";

const site = (p: Partial<Site> = {}) => ({ id: "s1", name: "Ghost Store", url: "https://example.com/", plan: "pro", banned_topics: [], tone: "friendly", conversion_cards: [], ...p }) as Site;

test("bot modes: unknown values fall back to assistant; support playbook goes into the prompt", () => {
  assert.equal(botMode({ bot_mode: undefined }), "assistant");
  assert.equal(botMode({ bot_mode: "support" }), "support");
  const p = buildSystemPrompt(site({ bot_mode: "support", support: { canned: [{ title: "Refunds", text: "Refunds take 5 days." }] } }), []);
  assert.match(p, /SUPPORT PLAYBOOK/);
  assert.match(p, /step by step/);
  assert.match(p, /never ask for passwords/);
  assert.match(p, /Refunds take 5 days/);
  assert.match(buildSystemPrompt(site({ bot_mode: "sales" }), []), /SALES PLAYBOOK/);
  assert.match(buildSystemPrompt(site({ bot_mode: "recommendations" }), []), /RECOMMENDATIONS PLAYBOOK/);
  assert.doesNotMatch(buildSystemPrompt(site(), []), /PLAYBOOK/);
});

test("support hours: in/out of hours in the owner's time zone, overnight shifts, and the out-of-hours line", () => {
  const s = normalizeSupport({ hours: { enabled: true, tz: "Europe/London", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" } });
  assert.equal(withinSupportHours(s, new Date("2026-11-16T10:00:00Z")), true); // Monday 10:00 UK
  assert.equal(withinSupportHours(s, new Date("2026-11-16T18:00:00Z")), false);
  assert.equal(withinSupportHours(s, new Date("2026-11-15T10:00:00Z")), false); // Sunday
  const night = normalizeSupport({ hours: { enabled: true, tz: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" } });
  assert.equal(withinSupportHours(night, new Date("2026-11-16T23:30:00Z")), true);
  assert.equal(withinSupportHours(night, new Date("2026-11-16T12:00:00Z")), false);
  assert.equal(withinSupportHours(DEFAULT_SUPPORT), true, "hours off = always in hours");
  const p = modePlaybook({ bot_mode: "support", name: "X", support: { ...s, out_of_hours_message: "Back at 9am." } }, new Date("2026-11-16T20:00:00Z"));
  assert.match(p, /OUT OF HOURS/);
  assert.match(p, /Back at 9am/);
});

test("support settings are sanitised (bad tz, bad times, canned limits)", () => {
  const s = normalizeSupport({ hours: { tz: "Mars/Base", start: "25:00", days: [1, 9, "2"] }, canned: [{ title: "a", text: "b" }, { title: "", text: "x" }], quick_replies: ["Track my order", "", "Talk to a human"], csat: "nope" });
  assert.equal(s.hours.tz, "Europe/London");
  assert.equal(s.hours.start, "09:00");
  assert.deepEqual(s.hours.days, [1, 2]);
  assert.equal(s.canned.length, 1);
  assert.deepEqual(s.quick_replies, ["Track my order", "Talk to a human"]);
  assert.equal(s.csat, "stars");
  assert.deepEqual(supportSettings({ support: null }).quick_replies, ["Track my order", "Report a problem", "Talk to a human"]);
});

test("anger detection and ticket priority", () => {
  assert.ok(detectAnger("This is ridiculous, I want a refund now"));
  assert.ok(detectAnger("WHERE IS MY ORDER I PAID LAST WEEK"));
  assert.ok(detectAnger("hello???!!!"));
  assert.ok(!detectAnger("Hi, where is my order?"));
  assert.equal(ticketPriority("this is the worst service"), "urgent");
  assert.equal(ticketPriority("I was charged twice"), "high");
  assert.equal(ticketPriority("Can I change my delivery address?"), "normal");
  assert.equal(higherPriority("normal", "urgent"), "urgent");
  assert.equal(higherPriority("high", "low"), "high");
  assert.equal(ticketSubject("  My parcel never arrived and the tracking link is broken, please can someone look into this today  "), "My parcel never arrived and the tracking link is broken, please can someone…");
});

test("in-chat forms: owner fields, email always required, validation and notes", () => {
  const f = normalizeChatForm({ enabled: true, fields: ["name", { key: "date", required: true }, "message", "bogus"], triggers: "book, quote" });
  assert.deepEqual(f.fields.map((x) => x.key), ["email", "name", "date", "message"]);
  assert.ok(f.fields.find((x) => x.key === "email")!.required);
  assert.ok(formMatches(f, "Can I book a table?"));
  assert.ok(!formMatches(f, "What's on the menu?"));
  assert.ok(!formMatches(normalizeChatForm({ enabled: false }), "book"));
  assert.equal(validateSubmission(f.fields, { email: "bad" }).ok, false);
  assert.equal(validateSubmission(f.fields, { email: "a@b.co" }).ok, false, "date required");
  const ok = validateSubmission(f.fields, { email: "a@b.co", date: "2026-12-01", message: "Table for 4" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(submissionNotes(ok.values), "Preferred date: 2026-12-01\nMessage: Table for 4");
  assert.equal(chatForm({ chat_form: {} }).enabled, false);
});

test("support mode offers the ticket form (name, email, order, message) and the owner form on triggers", () => {
  const cards = selectCards({ site: site(), message: "it's broken", answer: "", support: { offer: true, outOfHours: null } });
  assert.equal(cards[0].kind, "support");
  assert.deepEqual(cards[0].fields!.map((f) => f.key), SUPPORT_FORM_FIELDS.map((f) => f.key));
  const ooh = selectCards({ site: site(), message: "help", support: { offer: true, outOfHours: "We're back at 9am." } });
  assert.equal(ooh[0].subtitle, "We're back at 9am.");
  const lead = selectCards({ site: site({ chat_form: { enabled: true, triggers: ["quote"] } }), message: "Can I get a quote?" });
  assert.equal(lead[0].kind, "lead");
  assert.equal(selectCards({ site: site(), message: "hello" }).length, 0);
});
