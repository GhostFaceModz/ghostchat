import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizeMeta } from "../server/src/lib/audit.ts";

test("audit meta drops secrets, site keys and message content", () => {
  const clean = sanitizeMeta({
    role: "agent",
    email: "teammate@example.com",
    message: "visitor said this",
    answer: "should not be stored",
    token: "abc",
    site_key: "gc_demo_ghostchat_pro",
    snippet: "<script data-id='gc_xxx'>",
    fields: ["name", "tone"],
    note: "Updated greeting",
    byok: "secret-value",
    ok: true,
  });
  assert.equal(clean.role, "agent");
  assert.equal(clean.email, "teammate@example.com");
  assert.deepEqual(clean.fields, ["name", "tone"]);
  assert.equal(clean.note, "Updated greeting");
  assert.equal(clean.ok, true);
  assert.equal("message" in clean, false);
  assert.equal("answer" in clean, false);
  assert.equal("token" in clean, false);
  assert.equal("site_key" in clean, false);
  assert.equal("snippet" in clean, false);
  assert.equal("byok" in clean, false);
  assert.equal(Object.values(clean).some((v) => typeof v === "string" && v.includes("gc_demo")), false);
});

test("the account page has an audit log and the API is listed", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/src/routes/team.ts", import.meta.url), "utf8");
  assert.match(html, /acct-audit/);
  assert.match(js, /\/api\/team\/audit/);
  assert.match(routes, /teamRouter.get\("\/audit"/);
  assert.match(routes, /team.invite/);
});
