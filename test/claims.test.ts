import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SESSION_SECRET ||= "test-session-secret";
const c = await import("../server/src/lib/discordClaim.ts");
const live = await import("../server/src/lib/live.ts");
const ID = "6f982c08-efec-45f2-be5d-3f82aa6fd084";

test("custom ids: only gcl actions with a uuid are accepted", () => {
  assert.deepEqual(c.parseCustomId(`gcl:claim:${ID}`), { action: "claim", convId: ID });
  assert.deepEqual(c.parseCustomId(`gcl:transferto:${ID}`), { action: "transferto", convId: ID });
  assert.equal(c.parseCustomId(`gcl:nuke:${ID}`), null);
  assert.equal(c.parseCustomId("ticket:open"), null);
  assert.equal(c.parseCustomId(`gcl:claim:${ID}x`), null);
});

test("claim buttons per state", () => {
  const ids = (s: string) => (c.claimComponents(ID, s as never)[0]?.components || []).map((b: { custom_id: string }) => b.custom_id.split(":")[1]);
  assert.deepEqual(ids("open"), ["claim"]);
  assert.deepEqual(ids("claimed"), ["unclaim", "transfer", "back", "close"]);
  assert.deepEqual(ids("back"), ["claim"]);
  assert.deepEqual(c.claimComponents(ID, "closed"), []);
  assert.deepEqual(c.claimComponents(ID, "timeout"), []);
  assert.ok(c.claimComponents(ID, "claimed")[0].components.every((b: { custom_id: string }) => b.custom_id.length <= 100));
});

test("embed shows the question, transcript snippet, site and who claimed it", () => {
  const conv = { session_id: "s_abcdef123456", reason: "asked", page_url: "https://ghostflix.uk/", claimed_by_id: "42" };
  const lines = [{ role: "assistant", message: "Hi!" }, { role: "user", message: "Can I talk to a human?" }];
  const open = c.claimEmbed({ name: "GhostFlix" }, conv, lines, "open");
  assert.match(open.description, /Waiting for a team member/);
  assert.equal(open.fields[0].value, "Can I talk to a human?");
  assert.match(open.fields[1].value, /👤 Can I talk/);
  assert.equal(open.fields[2].value, "GhostFlix");
  assert.match(c.claimEmbed({ name: "GhostFlix" }, conv, lines, "claimed", "42").description, /Claimed by <@42>/);
  assert.ok(JSON.stringify(open).length < 6000, "within Discord embed limits");
});

test("only the claimer or moderators can unclaim/transfer/close", () => {
  assert.equal(c.canManage("0", "42", { claimed_by_id: "42" }), true);
  assert.equal(c.canManage("0", "7", { claimed_by_id: "42" }), false);
  assert.equal(c.canManage(String(1n << 34n), "7", { claimed_by_id: "42" }), true, "Manage Threads");
  assert.equal(c.canManage("8", "7", { claimed_by_id: "42" }), true, "Administrator");
  assert.equal(c.canManage("garbage", "7", { claimed_by_id: null }), false);
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
