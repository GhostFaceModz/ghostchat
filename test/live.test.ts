import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ||= "test-session-secret";
process.env.DISCORD_RELAY_SECRET = "relay-secret";

const live = await import("../server/src/lib/live.ts");
const relay = await import("../server/src/lib/relay.ts");
const { wantsHandoff } = await import("../server/src/lib/chat.ts");

const pro = (live_chat: Record<string, unknown>) => ({ plan: "pro" as const, live_chat, name: "GhostFlix" });

test("live settings normalise and default safely", () => {
  const s = live.liveSettings({ live_chat: { enabled: true, trigger: "weird", misses: 99, status: "x", agent_name: "  Zane  " } } as never);
  assert.deepEqual(s, { enabled: true, trigger: "ask_or_misses", misses: 5, status: "online", agent_name: "Zane", claim_timeout_min: 5, timeout_fallback: "ai", idle_timeout_min: 15 });
  assert.equal(live.liveSettings({ live_chat: null } as never).enabled, false);
  const next = live.normalizeLiveSettings({ status: "away" }, s);
  assert.equal(next.status, "away");
  assert.equal(next.enabled, true);
});

test("live chat is Pro-gated and needs the owner online", () => {
  assert.equal(live.liveAvailable({ plan: "free", live_chat: { enabled: true } } as never), false);
  assert.equal(live.liveAvailable(pro({ enabled: true }) as never), true);
  assert.equal(live.liveAvailable({ plan: "business", live_chat: { enabled: true } } as never), true);
  assert.equal(live.liveOnline(pro({ enabled: true, status: "away" }) as never), false);
});

test("handoff triggers: asked, after N misses, never", () => {
  const site = pro({ enabled: true, misses: 2 }) as never;
  assert.equal(live.shouldStartLive(site, "can I talk to a human please", 0), "asked");
  assert.equal(live.shouldStartLive(site, "what's on tonight", 1), null);
  assert.equal(live.shouldStartLive(site, "what's on tonight", 2), "misses");
  assert.equal(live.shouldStartLive(pro({ enabled: true, trigger: "ask" }) as never, "what?", 5), null);
  assert.equal(live.shouldStartLive(pro({ enabled: true, trigger: "misses" }) as never, "speak to a real person", 0), null);
  assert.equal(live.shouldStartLive(pro({ enabled: true, trigger: "never" }) as never, "talk to a human", 9), null);
  assert.equal(live.shouldStartLive({ plan: "free", live_chat: { enabled: true } } as never, "talk to a human", 9), null);
});

test("live handoff replaces the email form only when the owner is online", async () => {
  const on = { id: "x", ...pro({ enabled: true }) } as never;
  assert.equal(await wantsHandoff(on, "s", "talk to a human", true), false);
  const away = { id: "x", ...pro({ enabled: true, status: "away" }) } as never;
  assert.equal(await wantsHandoff(away, "s", "talk to a human", true), true);
});

test("agent display name falls back to the owner's first name, then the team", () => {
  assert.equal(live.agentDisplayName(pro({ agent_name: "Zee" }) as never, "Zane Barker"), "Zee");
  assert.equal(live.agentDisplayName(pro({}) as never, "Zane Barker"), "Zane");
  assert.equal(live.agentDisplayName(pro({}) as never, null), "the GhostFlix team");
});

test("own-bot tokens are encrypted at rest and round-trip", () => {
  const token = "123456789:AAEexampleexampleexampleexampleexample";
  const blob = live.encryptSecret(token);
  assert.ok(!blob.includes(token));
  assert.match(blob, /^v1\./);
  assert.equal(live.decryptSecret(blob), token);
  assert.notEqual(live.encryptSecret(token), blob, "random IV");
  const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "B" : "A") + blob.slice(-1);
  assert.throws(() => live.decryptSecret(tampered));
});

test("link codes and webhook secrets use Telegram-safe characters", () => {
  assert.match(live.newLinkCode(), /^GC-[A-Z2-9]{8}$/);
  const sec = live.channelWebhookSecret("abc");
  assert.match(sec, /^[A-Za-z0-9_-]{1,256}$/);
  assert.equal(sec, live.channelWebhookSecret("abc"));
  assert.notEqual(sec, live.channelWebhookSecret("abd"));
});

test("Discord relay HMAC: valid, tampered, stale", () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "message", thread_id: "1", content: "hi" });
  const sig = relay.discordRelaySignature(ts, body);
  assert.equal(relay.verifyDiscordRelay(ts, sig, body), true);
  assert.equal(relay.verifyDiscordRelay(ts, sig, body + " "), false);
  assert.equal(relay.verifyDiscordRelay(ts, "0".repeat(64), body), false);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal(relay.verifyDiscordRelay(old, relay.discordRelaySignature(old, body), body), false);
  assert.equal(relay.verifyDiscordRelay(undefined, sig, body), false);
});

test("GhostBot invite asks only for what live chat needs", () => {
  const perms = BigInt(relay.DISCORD_PERMISSIONS);
  const has = (bit: bigint) => (perms & bit) === bit;
  assert.ok(has(1n << 10n) && has(1n << 11n) && has(1n << 38n) && has(1n << 35n) && has(1n << 34n) && has(1n << 16n));
  assert.equal(has(1n << 3n), false, "no Administrator");
  assert.equal(has(1n << 36n), false, "no Create Private Threads");
  assert.match(relay.DISCORD_INVITE_URL, /client_id=1558950916823195718/);
});

test("typing indicators expire", () => {
  live.setTyping("c1", "agent");
  assert.equal(live.isTyping("c1", "agent"), true);
  assert.equal(live.isTyping("c1", "visitor"), false);
});
