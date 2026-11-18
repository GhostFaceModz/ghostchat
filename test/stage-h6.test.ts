import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isSlackIncomingWebhookUrl,
  normalizeSlackWebhookUrl,
  postSlackWaitingAlert,
  slackWaitingText,
} from "../server/src/lib/slackWebhook.ts";

const FAKE = ["https://hooks.slack.com", "services", "T" + "0".repeat(8), "B" + "0".repeat(8), "X".repeat(24)].join("/");

test("only official Slack incoming webhook URLs are accepted", () => {
  assert.equal(isSlackIncomingWebhookUrl(FAKE), true);
  assert.equal(isSlackIncomingWebhookUrl("http://hooks.slack.com/services/" + "T0".repeat(3) + "/B0/xxxx"), false);
  assert.equal(isSlackIncomingWebhookUrl("https://hooks.slack.com.evil.example/services/nope"), false);
  assert.equal(isSlackIncomingWebhookUrl("https://example.com/services/nope"), false);
  assert.equal(isSlackIncomingWebhookUrl(FAKE + "?x=1"), false);
  assert.deepEqual(normalizeSlackWebhookUrl("  "), { url: null });
  assert.equal(Boolean(normalizeSlackWebhookUrl("not-a-url").error), true);
  assert.equal(normalizeSlackWebhookUrl(FAKE).url, FAKE);
});

test("waiting-chat Slack posts go to the pasted URL and never invent a hook", async () => {
  const posted: Array<{ url: string; body: string }> = [];
  const ok = await postSlackWaitingAlert({
    webhookUrl: FAKE,
    siteName: "Demo Shop",
    why: "the bot couldn't answer",
    fetchImpl: async (url, init) => {
      posted.push({ url, body: String(init?.body || "") });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(ok, true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, FAKE);
  assert.match(posted[0].body, /Demo Shop/);
  assert.match(posted[0].body, /waiting for a human/);
  assert.equal(slackWaitingText("Demo Shop").includes("hooks.slack.com"), false);

  const rejected = await postSlackWaitingAlert({
    webhookUrl: "https://example.com/not-slack",
    siteName: "Demo Shop",
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(rejected, false);
});

test("account settings and announceHandoff wire up the Slack incoming webhook", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261118140000_ghostchat_slack_webhook.sql", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../server/src/routes/auth.ts", import.meta.url), "utf8");
  const relay = readFileSync(new URL("../server/src/lib/relay.ts", import.meta.url), "utf8");
  const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  assert.match(sql, /ghostchat_owners/);
  assert.match(sql, /slack_webhook_url/);
  assert.match(auth, /\/slack-webhook/);
  assert.match(relay, /postSlackWaitingAlert/);
  assert.match(relay, /conv\.status === "waiting"/);
  assert.match(dash, /acct-slack-form/);
  assert.match(app, /\/api\/auth\/slack-webhook/);
});
