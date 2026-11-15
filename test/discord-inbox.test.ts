import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SESSION_SECRET ||= "test-session-secret";
const inbox = await import("../server/src/lib/discordInbox.ts");
const live = await import("../server/src/lib/live.ts");
const claim = await import("../server/src/lib/discordClaim.ts");
const handoff = await import("../server/src/lib/handoff.ts");
const ID = "6f982c08-efec-45f2-be5d-3f82aa6fd084";

test("inbox cards: Claim, View transcript, Close ticket; Claim disables after take", () => {
  const open = inbox.inboxComponents(ID, "open");
  const actions = open.flatMap((r) => r.components.map((c: { custom_id: string }) => c.custom_id.split(":")[1]));
  assert.deepEqual(actions, ["claim", "transcript", "closethread"]);
  const claimed = inbox.inboxComponents(ID, "claimed", { claimedByName: "Zane" });
  const claimBtn = claimed[0].components.find((c: { custom_id: string }) => c.custom_id.includes(":claim:")) as { label: string; disabled: boolean };
  assert.equal(claimBtn.disabled, true);
  assert.match(claimBtn.label, /Claimed by Zane/);
  assert.ok(claimed.flatMap((r) => r.components).some((c: { custom_id: string }) => c.custom_id.includes(":transfer:")));
  const closed = inbox.inboxComponents(ID, "closed");
  assert.equal((closed[0].components.find((c: { custom_id: string }) => c.custom_id.includes(":closethread:")) as { disabled: boolean }).disabled, true);
  assert.equal((closed[0].components.find((c: { custom_id: string }) => c.custom_id.includes(":transcript:")) as { disabled: boolean }).disabled, false);
});

test("inbox embed is compact and shows closed rating", () => {
  const conv = { session_id: "s_ti09ut1gfssmwg26lmu", reason: "asked", page_url: "https://ghostflix.uk/", claimed_by_id: "42", review_pending: true };
  const lines = [
    { role: "assistant", message: "I can help you find something to watch.", lang: "en" },
    { role: "user", message: "Can I talk to a human?", lang: "en" },
  ];
  const open = inbox.inboxEmbed({ name: "GhostFlix" }, conv, lines, "open");
  assert.match(open.title, /GhostFlix · visitor g26lmu/);
  assert.match(open.description, /Claim/);
  assert.equal(open.fields.find((f: { name: string }) => f.name === "Language")?.value, "English");
  assert.match(open.fields.find((f: { name: string }) => f.name === "AI summary")?.value || "", /find something/);
  const closed = inbox.inboxEmbed({ name: "GhostFlix" }, conv, lines, "closed", "42", { rating: 5 });
  assert.match(closed.description, /Closed · ★★★★★/);
});

test("DM controls and visitor messages stay separate per visitor", () => {
  const dm = inbox.dmControlComponents(ID, "claimed", { quickReplies: ["On it"] });
  const actions = dm.flatMap((r) => r.components.map((c: { custom_id?: string }) => String(c.custom_id || "").split(":")[1])).filter(Boolean);
  assert.deepEqual(actions, ["close", "back", "transfer", "transcript", "closethread", "qreply"]);
  const ended = inbox.dmControlComponents(ID, "closed");
  assert.ok(ended[0].components.every((c: { disabled?: boolean }) => c.disabled));
  const vis = inbox.visitorMessageComponents(ID);
  const vActions = vis[0].components.map((c: { custom_id: string }) => c.custom_id.split(":")[1]);
  assert.deepEqual(vActions, ["replymodal", "switch"]);
  const embed = inbox.visitorMessageEmbed({ name: "GhostFlix" }, "s_aaaag26lmu", "I need help");
  assert.match(embed.title, /GhostFlix · g26lmu/);
  assert.equal(embed.description, "I need help");
  assert.equal(inbox.visitorColor("s_aaaag26lmu"), inbox.visitorColor("s_aaaag26lmu"));
  assert.notEqual(inbox.visitorColor("visitor-a"), inbox.visitorColor("visitor-b"));
});

test("typed replies only confirm the visitor when the agent has two or more open chats", () => {
  assert.equal(inbox.sentConfirmation("GhostFlix", "s_xxg26lmu", 1), null);
  assert.match(inbox.sentConfirmation("GhostFlix", "s_xxg26lmu", 2) || "", /g26lmu/);
  const modal = inbox.replyModal(ID, "GhostFlix", "s_xxg26lmu");
  assert.equal(modal.type, 9);
  assert.match(modal.data.custom_id, /replymodal/);
});

test("legacy button ids still parse, including reply modal and switch", () => {
  assert.deepEqual(claim.parseCustomId(`gcl:replymodal:${ID}`), { action: "replymodal", convId: ID });
  assert.deepEqual(claim.parseCustomId(`gcl:switch:${ID}`), { action: "switch", convId: ID });
  assert.deepEqual(claim.parseCustomId(`gcl:close:${ID}`), { action: "close", convId: ID });
  assert.deepEqual(claim.parseCustomId(`gcl:end:${ID}`), { action: "close", convId: ID });
});

test("idle auto-close warns two minutes before, then closes; activity resets it", () => {
  const now = Date.parse("2026-11-15T05:00:00Z");
  const base = {
    status: "human" as const,
    last_visitor_at: "2026-11-15T04:47:00Z",
    last_agent_at: "2026-11-15T04:46:00Z",
    claimed_at: "2026-11-15T04:40:00Z",
    updated_at: "2026-11-15T04:47:00Z",
    created_at: "2026-11-15T04:40:00Z",
    close_warned_at: null as string | null,
  };
  const settings = { idle_timeout_min: 15 };
  assert.equal(live.idleAction({ ...base, last_visitor_at: "2026-11-15T04:50:00Z", updated_at: "2026-11-15T04:50:00Z" }, settings, now), null);
  assert.equal(live.idleAction(base, settings, now), "warn"); // 13 min idle
  assert.equal(live.idleAction({ ...base, close_warned_at: "2026-11-15T04:58:00Z" }, settings, now), null);
  assert.equal(live.idleAction({ ...base, last_visitor_at: "2026-11-15T04:44:00Z", last_agent_at: "2026-11-15T04:44:00Z", updated_at: "2026-11-15T04:44:00Z" }, settings, now), "close");
  assert.equal(live.idleAction({ ...base, status: "waiting" }, settings, now), null);
  assert.equal(live.liveSettings({ live_chat: {} } as never).idle_timeout_min, 15);
  assert.equal(live.liveSettings({ live_chat: { idle_timeout_min: 3 } } as never).idle_timeout_min, 3);
  assert.equal(live.liveSettings({ live_chat: { idle_timeout_min: 200 } } as never).idle_timeout_min, 120);
  assert.equal(live.isLegacyThreadChat({ discord_thread_id: "1", discord_dm_channel_id: null }), true);
  assert.equal(live.isLegacyThreadChat({ discord_thread_id: "1", discord_dm_channel_id: "dm" }), false);
  assert.match(handoff.endChatAgentNotice("end", "idle"), /inactivity/i);
});

test("claim-opened copy explains DMs and the private-thread fallback", () => {
  assert.match(inbox.claimOpenedMessage("dm"), /DM/);
  assert.match(inbox.claimOpenedMessage("private_thread"), /private thread/i);
  assert.match(inbox.claimOpenedMessage(null, "Discord 403: Cannot send messages to this user"), /dashboard|DMs/i);
});
