import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SESSION_SECRET ||= "test-session-secret";
const c = await import("../server/src/lib/discordClaim.ts");
const live = await import("../server/src/lib/live.ts");
const ID = "6f982c08-efec-45f2-be5d-3f82aa6fd084";

test("custom ids: only gcl actions with a uuid are accepted", () => {
  assert.deepEqual(c.parseCustomId(`gcl:claim:${ID}`), { action: "claim", convId: ID });
  assert.deepEqual(c.parseCustomId(`gcl:transferto:${ID}`), { action: "transferto", convId: ID });
  assert.deepEqual(c.parseCustomId(`gcl:transcript:${ID}`), { action: "transcript", convId: ID });
  assert.deepEqual(c.parseCustomId(`gcl:qreply:${ID}`), { action: "qreply", convId: ID });
  assert.deepEqual(c.parseCustomId(`gcl:close:${ID}`), { action: "close", convId: ID });
  assert.equal(c.parseCustomId(`gcl:nuke:${ID}`), null);
  assert.equal(c.parseCustomId("ticket:open"), null);
  assert.equal(c.parseCustomId(`gcl:claim:${ID}x`), null);
});

test("claim buttons per state: Accept, End chat, hand back, transfer, unclaim, transcript, ticket, quick replies", () => {
  const open = c.componentActions(c.claimComponents(ID, "open"));
  assert.deepEqual(open, ["claim", "close", "transcript", "ticket"]);
  const claimed = c.claimComponents(ID, "claimed", { quickReplies: ["We're looking into this now"] });
  assert.deepEqual(c.componentActions(claimed), ["close", "back", "transfer", "unclaim", "transcript", "ticket", "qreply"]);
  assert.equal(claimed[0].components.find((b: { custom_id: string }) => b.custom_id.includes(":close:"))?.label, "End chat");
  assert.equal(claimed[0].components.find((b: { custom_id: string }) => b.custom_id.includes(":claim:"))?.label, undefined);
  const withTicket = c.componentActions(c.claimComponents(ID, "claimed", { hasTicket: true }));
  assert.ok(withTicket.includes("resolve"));
  assert.deepEqual(c.componentActions(c.claimComponents(ID, "back")), ["claim", "close", "transcript", "ticket"]);
  assert.ok(c.componentActions(c.claimComponents(ID, "claimed")).every((a) => a !== "block"), "no block-visitor button without spam protection");
  assert.ok(claimed.flatMap((r) => r.components).every((b: { custom_id: string }) => b.custom_id.length <= 100));
});

test("live controls stay enabled after an agent-message refresh; only ending the chat disables them", () => {
  const before = c.claimComponents(ID, "claimed", { quickReplies: ["On it"] });
  // The same payload is re-applied when an agent or visitor message is relayed.
  const afterRelay = c.claimComponents(ID, "claimed", { quickReplies: ["On it"] });
  assert.equal(c.anyComponentDisabled(before), false);
  assert.equal(c.anyComponentDisabled(afterRelay), false);
  assert.ok(c.componentActions(afterRelay).includes("close"));
  assert.ok(c.componentActions(afterRelay).includes("unclaim"));
  const closed = c.claimComponents(ID, "closed");
  assert.ok(closed.length, "ended chats keep the button layout visible");
  assert.equal(c.anyComponentDisabled(closed), true);
  assert.equal(c.anyComponentDisabled(c.claimComponents(ID, "timeout")), true);
  assert.equal(c.anyComponentDisabled(c.claimComponents(ID, "open")), false);
});

test("embed shows page, language, conversation start, AI summary, claimant and rating", () => {
  const conv = { session_id: "s_abcdef123456", reason: "asked", page_url: "https://ghostflix.uk/", claimed_by_id: "42", review_pending: true };
  const lines = [
    { role: "assistant", message: "Hi — I can help you find something to watch.", lang: "en" },
    { role: "user", message: "Can I talk to a human?", lang: "en" },
  ];
  const open = c.claimEmbed({ name: "GhostFlix" }, conv, lines, "open");
  const field = (name: string) => open.fields.find((f: { name: string }) => f.name === name)?.value;
  assert.match(open.description, /Accept \/ Claim|Waiting for a team member/);
  assert.equal(field("Visitor asked"), "Can I talk to a human?");
  assert.match(field("Page") || "", /ghostflix\.uk/);
  assert.equal(field("Language"), "English");
  assert.match(field("Start of the conversation") || "", /Hi — I can help/);
  assert.match(field("AI summary") || "", /find something to watch/);
  assert.match(c.claimEmbed({ name: "GhostFlix" }, conv, lines, "claimed", "42").description, /Claimed by <@42>/);
  const closed = c.claimEmbed({ name: "GhostFlix" }, conv, lines, "closed", "42", { rating: 5, comment: "Great help" });
  assert.match(closed.fields.find((f: { name: string }) => f.name === "Visitor rating")?.value || "", /5\/5/);
  assert.match(closed.fields.find((f: { name: string }) => f.name === "Visitor rating")?.value || "", /Great help/);
  assert.ok(JSON.stringify(open).length < 6000, "within Discord embed limits");
});

test("only the claimer or moderators can unclaim/transfer/end a chat", () => {
  assert.equal(c.canManage("0", "42", { claimed_by_id: "42" }), true);
  assert.equal(c.canManage("0", "7", { claimed_by_id: "42" }), false);
  assert.equal(c.canManage(String(1n << 34n), "7", { claimed_by_id: "42" }), true, "Manage Threads");
  assert.equal(c.canManage("8", "7", { claimed_by_id: "42" }), true, "Administrator");
  assert.equal(c.canManage("garbage", "7", { claimed_by_id: null }), false);
  assert.equal(c.canManage("0", "7", { claimed_by_id: null }), false, "unclaimed: only admins can end or transfer");
  assert.equal(c.canManage("8", "7", { claimed_by_id: null }), true);
});

test("staff names are the Discord display name, trimmed and capped at 32 characters", () => {
  assert.equal(c.supportName("Zane"), "Zane");
  assert.equal(c.supportName("  "), "Team");
  assert.equal(c.supportName("<b>Sam</b>"), "Sam");
  assert.equal(c.supportName("A".repeat(40)).length, 32);
});

test("waiting handoffs time out after the configured minutes", () => {
  const now = Date.parse("2026-11-14T07:10:00Z");
  const conv = { status: "waiting" as const, waiting_since: "2026-11-14T07:04:00Z", updated_at: "2026-11-14T07:09:00Z", last_agent_at: null };
  assert.equal(live.handoffTimedOut(conv, { claim_timeout_min: 5 }, now), true);
  assert.equal(live.handoffTimedOut(conv, { claim_timeout_min: 10 }, now), false);
  assert.equal(live.handoffTimedOut({ ...conv, status: "human" }, { claim_timeout_min: 1 }, now), false);
  assert.equal(live.liveSettings({ live_chat: { claim_timeout_min: 99, timeout_fallback: "form" } } as never).claim_timeout_min, 30);
  assert.equal(live.liveSettings({ live_chat: {} } as never).claim_timeout_min, 5);
  assert.equal(live.liveSettings({ live_chat: { timeout_fallback: "x" } } as never).timeout_fallback, "ai");
});

test("language labels and AI summaries are safe when data is missing", () => {
  assert.equal(c.languageLabel("en"), "English");
  assert.equal(c.languageLabel("es-MX"), "Spanish");
  assert.equal(c.languageLabel(""), "");
  assert.equal(c.aiSummary([{ role: "user", message: "Hi" }]), null);
  assert.equal(c.conversationStart([]), "—");
  assert.match(c.inboxUrl("6f982c08-efec-45f2-be5d-3f82aa6fd084", "s_g26lmu"), /inbox=/);
});
