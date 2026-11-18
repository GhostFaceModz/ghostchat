import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { creditPeriod, nextCreditState, normalizeCreditCap } from "../server/src/lib/agentCredits.ts";

test("agent credit caps reset each month and reject empty or huge values", () => {
  assert.equal(normalizeCreditCap(""), null);
  assert.equal(normalizeCreditCap(25), 25);
  assert.equal(normalizeCreditCap(99999), 10000);
  assert.equal(creditPeriod(new Date("2026-11-18T00:30:00Z"), "Europe/London"), "2026-11");
  const fresh = nextCreditState({ credit_cap: 10, credits_used: 9, credits_period: "2026-10" }, "2026-11");
  assert.equal(fresh.used, 0);
  assert.equal(fresh.remaining, 10);
  const tight = nextCreditState({ credit_cap: 10, credits_used: 10, credits_period: "2026-11" }, "2026-11");
  assert.equal(tight.remaining, 0);
});

test("team settings and copilot routes honour per-agent caps", () => {
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/team.ts", import.meta.url), "utf8");
  const email = readFileSync(new URL("../server/src/routes/email.ts", import.meta.url), "utf8");
  assert.match(js, /credit_cap/);
  assert.match(routes, /setMemberCreditCap/);
  assert.match(email, /consumeDashboardCredit/);
});
