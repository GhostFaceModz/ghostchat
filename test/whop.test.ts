import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { verifyWhopSignature, isUpgradeEvent, isDowngradeEvent, parseWhopEvent, extractWhopBilling } from "../server/src/lib/whop.ts";

test("verifies a Standard Webhooks signature", () => {
  const secret = "ws_testsecret";
  const id = "msg_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "{\"type\":\"membership.went_valid\"}";
  const sig = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  assert.equal(verifyWhopSignature({ rawBody, id, timestamp, signature: `v1,${sig}`, secret }), true);
  assert.equal(verifyWhopSignature({ rawBody, id, timestamp, signature: "v1,nope", secret }), false);
});

test("classifies Whop membership events", () => {
  assert.equal(isUpgradeEvent("membership.went_valid"), true);
  assert.equal(isDowngradeEvent("membership.went_invalid"), true);
  assert.equal(isDowngradeEvent("membership.cancel_at_period_end_changed"), false);
});

test("extracts email and plan ids from a Whop payload", () => {
  const event = parseWhopEvent(JSON.stringify({
    id: "ev_1",
    type: "membership.went_valid",
    data: { id: "mem_1", user: { id: "user_1", email: "zane@example.com" }, plan: { id: "plan_pro" } },
  }));
  const info = extractWhopBilling(event);
  assert.equal(info.email, "zane@example.com");
  assert.equal(info.planId, "plan_pro");
  assert.equal(info.membershipId, "mem_1");
});

test("reads the membership id from payment events and the owner/plan from metadata", () => {
  const event = parseWhopEvent(JSON.stringify({
    type: "payment.succeeded",
    data: { id: "pay_1", membership: "mem_9", metadata: { ghostchat_owner_id: "owner-1", ghostchat_plan: "pro" } },
  }));
  const info = extractWhopBilling(event);
  assert.equal(info.membershipId, "mem_9");
  assert.equal(info.metadataOwnerId, "owner-1");
  assert.equal(info.metadataPlan, "pro");
});
