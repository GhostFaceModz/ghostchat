import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PLAN_LIMITS } from "../server/src/config.ts";
import { seatsFor, canUseDigest, canUseCopilot, canUseEmailChannel, canWriteSettings, canAgentAct, hashInviteToken, isMemberRole } from "../server/src/lib/team.ts";
import { isoWeekKey, renderDigestText, type DigestPayload } from "../server/src/lib/digest.ts";
import { isBotTestInbox, mailerConfigured } from "../server/src/lib/mailer.ts";
import { parseInbound, newInboundToken, inboundWebhookUrl } from "../server/src/lib/emailChannel.ts";

test("plan seats and feature flags match the Stage E matrix", () => {
  assert.equal(seatsFor("free"), 1);
  assert.equal(seatsFor("pro"), 2);
  assert.equal(seatsFor("business"), 5);
  assert.equal(canUseDigest("free"), false);
  assert.equal(canUseDigest("pro"), true);
  assert.equal(canUseDigest("business"), true);
  assert.equal(canUseCopilot("pro"), false);
  assert.equal(canUseCopilot("business"), true);
  assert.equal(canUseEmailChannel("business"), true);
  assert.equal(canUseEmailChannel("free"), false);
  assert.equal(PLAN_LIMITS.pro.maxSeats, 2);
  assert.equal(PLAN_LIMITS.business.copilot, true);
});

test("roles: owner can change settings, agents can act, viewers cannot", () => {
  assert.equal(canWriteSettings("owner"), true);
  assert.equal(canWriteSettings("agent"), false);
  assert.equal(canAgentAct("agent"), true);
  assert.equal(canAgentAct("viewer"), false);
  assert.equal(isMemberRole("agent"), true);
  assert.equal(isMemberRole("owner"), false);
});

test("invite tokens are hashed, not stored in the clear", () => {
  const token = "a".repeat(32);
  const hashed = hashInviteToken(token);
  assert.equal(hashed.includes(token), false);
  assert.equal(hashed.length, 64);
  assert.equal(hashInviteToken(token), hashed);
});

test("digest text includes usage, leads, CSAT and unanswered questions", () => {
  const payload: DigestPayload = {
    week: "2026-W47",
    rangeLabel: "2026-11-11 – 2026-11-18",
    sites: [{ id: "1", name: "Demo", messages: 12, unanswered: 1 }],
    messages: 12,
    usage: { used: 40, limit: 5000, credits: 0, plan: "pro" },
    unanswered: [{ question: "Do you ship to Scotland?", site: "Demo" }],
    leads: 3,
    csat: { count: 2, average: 4.5 },
  };
  const letter = renderDigestText("Zane", payload);
  assert.match(letter.subject, /12 messages/);
  assert.match(letter.text, /3 new leads/);
  assert.match(letter.text, /4.5\/5/);
  assert.match(letter.text, /Do you ship to Scotland\?/);
  assert.match(letter.html, /Zane/);
  assert.match(isoWeekKey(new Date("2026-11-18T12:00:00Z")), /^2026-W\d{2}$/);
});

test("only @agentmail.to addresses are treated as bot-owned test inboxes", () => {
  assert.equal(isBotTestInbox("ghostapps@agentmail.to"), true);
  assert.equal(isBotTestInbox("Zane@Example.com"), false);
  assert.equal(typeof mailerConfigured(), "boolean");
});

test("inbound email parse requires a from address and a body", () => {
  assert.equal(parseInbound({ from: "Ada <ada@example.com>", text: "Hi, I need help with an order." })?.from, "ada@example.com");
  assert.equal(parseInbound({ From: "ada@example.com", HtmlBody: "<p>Hello there</p>" })?.text.includes("Hello"), true);
  assert.equal(parseInbound({ from: "not-an-email", text: "hi" }), null);
  assert.equal(parseInbound({ from: "ada@example.com", text: "" }), null);
  const token = newInboundToken();
  assert.ok(token.length >= 16);
  assert.match(inboundWebhookUrl(token), /\/api\/email\/inbound\//);
});

test("landing and dashboard mention seats, digest, copilot and visitor email", () => {
  const landing = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(landing, /2 team seats/);
  assert.match(landing, /5 team seats/);
  assert.match(landing, /weekly digest/i);
  assert.match(landing, /inbox copilot/i);
  assert.match(landing, /Visitor email channel/);
  const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(dash, /acct-team/);
  assert.match(dash, /acct-digest/);
  assert.match(dash, /email-channel/);
  assert.match(dash, /workspace-select/);
  const live = readFileSync(new URL("../dashboard/live.js", import.meta.url), "utf8");
  assert.match(live, /inbox-copilot/);
  assert.match(live, /email-channel/);
});
