import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ||= "test-session-secret";

const live = await import("../server/src/lib/live.ts");
const handoff = await import("../server/src/lib/handoff.ts");

test("sanitizeAgentName strips HTML, trims, and caps at 32 characters", () => {
  assert.equal(live.sanitizeAgentName("  Sam  "), "Sam");
  assert.equal(live.sanitizeAgentName("<b>Sam</b>"), "Sam");
  assert.equal(live.sanitizeAgentName("<script>alert(1)</script>Sam"), "alert(1)Sam");
  assert.equal(live.sanitizeAgentName("A".repeat(40)), "A".repeat(32));
  assert.equal(live.sanitizeAgentName("   "), "");
  assert.equal(live.sanitizeAgentName("", "Team"), "Team");
  assert.equal(live.sanitizeAgentName(null, "Team"), "Team");
});

test("resolveAgentName prefers a typed name, then a remembered one, then Discord", () => {
  assert.deepEqual(live.resolveAgentName({ provided: "  Sam  " }), { name: "Sam", needsName: false, source: "provided" });
  assert.deepEqual(live.resolveAgentName({ remembered: "Alex" }), { name: "Alex", needsName: false, source: "remembered" });
  assert.deepEqual(live.resolveAgentName({ discordId: "42", discordName: "Zane" }), { name: "Zane", needsName: false, source: "discord" });
  assert.deepEqual(live.resolveAgentName({ discordName: "Zane" }), { name: null, needsName: true, source: null });
  assert.deepEqual(live.resolveAgentName({}), { name: null, needsName: true, source: null });
  assert.equal(live.resolveAgentName({ provided: "<i>Sam</i>" }).name, "Sam");
});

test("Telegram agent names are remembered per user on the channel config", () => {
  const next = live.withTelegramAgentName({ chat_id: "1" }, "99", "Sam");
  assert.equal(live.telegramAgentName(next, "99"), "Sam");
  assert.equal(live.telegramAgentName(next, "100"), null);
  assert.equal((next as { chat_id: string }).chat_id, "1");
  const again = live.withTelegramAgentName(next, "99", "Sammy");
  assert.equal(live.telegramAgentName(again, "99"), "Sammy");
});

test("end-chat copy for the visitor and the agent", () => {
  assert.match(handoff.endChatSystemMessage("end"), /chat has been closed/i);
  assert.match(handoff.endChatSystemMessage("end"), /new one/i);
  assert.match(handoff.endChatSystemMessage("cancel"), /cancelled/i);
  assert.match(handoff.endChatSystemMessage("handback"), /back with the AI assistant/i);
  assert.match(handoff.endChatAgentNotice("end", "visitor"), /visitor ended the chat/i);
  assert.match(handoff.endChatAgentNotice("cancel", "visitor"), /cancelled/i);
  assert.match(handoff.endChatAgentNotice("end", "dashboard"), /closed/i);
  assert.match(handoff.endChatAgentNotice("handback", "discord"), /handed back/i);
});
