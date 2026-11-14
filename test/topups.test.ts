import assert from "node:assert/strict";
import { test } from "node:test";
import { decideSend, alertLevel } from "../server/src/lib/usage.ts";
import { topupFor, TOPUPS } from "../server/src/routes/billing.ts";
import { extractWhopBilling, parseWhopEvent } from "../server/src/lib/whop.ts";

test("usage comes from the allowance, then credits, then 10% grace, then pauses", () => {
  assert.equal(decideSend(199, 200, 0).reason, "allowance");
  assert.equal(decideSend(200, 200, 5).reason, "credits");
  assert.equal(decideSend(200, 200, 0).reason, "grace");
  assert.equal(decideSend(219, 200, 0).reason, "grace");
  assert.deepEqual(decideSend(220, 200, 0), { ok: false, reason: "paused" });
  assert.equal(decideSend(5000, 200, 1).ok, true);
});

test("alerts at 80% and 100%", () => {
  assert.equal(alertLevel(159, 200), 0);
  assert.equal(alertLevel(160, 200), 80);
  assert.equal(alertLevel(200, 200), 100);
});

test("top-up packs are recognised by plan id and carry the payment id", () => {
  assert.equal(TOPUPS.length, 2);
  assert.equal(topupFor(TOPUPS[0].id)?.messages, 1000);
  assert.equal(topupFor(TOPUPS[1].id)?.price, 15);
  assert.equal(topupFor("plan_other"), null);
  const info = extractWhopBilling(parseWhopEvent(JSON.stringify({ type: "payment.succeeded", data: { id: "pay_123", plan: { id: TOPUPS[1].id }, user: { email: "A@B.com" } } })));
  assert.equal(info.paymentId, "pay_123");
  assert.equal(info.planId, TOPUPS[1].id);
  assert.equal(info.email, "a@b.com");
});
