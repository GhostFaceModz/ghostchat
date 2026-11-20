import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalRedirect, isLegacyGoogleCallbackPath, HSTS_VALUE, PUBLIC_ERROR, publicErrorMessage } from "../server/src/lib/httpSecurity.js";
import { clientIp, rateLimit, _resetRateLimitMemory } from "../server/src/lib/rateLimit.js";
import { issueAuthTicket, redeemAuthTicket, sessionLandingUrl, _resetAuthTickets } from "../server/src/lib/authTickets.js";
import { widgetCacheControl } from "../server/src/lib/widgetAsset.js";

test("legacy onrender host 301s to ghostchat.pro except the Google OAuth callback", () => {
  assert.equal(canonicalRedirect("ghostchat.pro", "/login"), null);
  assert.equal(canonicalRedirect("ghostchat-nfoc.onrender.com", "/"), "https://ghostchat.pro/");
  assert.equal(canonicalRedirect("ghostchat-nfoc.onrender.com", "/login?x=1"), "https://ghostchat.pro/login?x=1");
  assert.equal(canonicalRedirect("ghostchat-nfoc.onrender.com", "/api/auth/google/callback"), null);
  assert.equal(canonicalRedirect("ghostchat-nfoc.onrender.com", "/api/auth/google/callback?code=abc"), null);
  assert.ok(isLegacyGoogleCallbackPath("/api/auth/google/callback"));
  assert.equal(isLegacyGoogleCallbackPath("/api/auth/google/finish"), false);
  assert.equal(canonicalRedirect("ghostchat-nfoc.onrender.com", "/api/auth/google/finish?t=x"), "https://ghostchat.pro/api/auth/google/finish?t=x");
});

test("HSTS and public errors never include raw Error.message", () => {
  assert.match(HSTS_VALUE, /max-age=31536000/);
  assert.equal(publicErrorMessage(new Error("SECRET_KEY leaked")), PUBLIC_ERROR);
  assert.doesNotMatch(PUBLIC_ERROR, /SECRET|stack|sql/i);
});

test("client IP prefers CF-Connecting-IP and never trusts the first X-Forwarded-For hop", () => {
  const cf = clientIp({ headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } });
  assert.equal(cf, "203.0.113.9");
  const last = clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.20" }, socket: { remoteAddress: "127.0.0.1" } });
  assert.equal(last, "198.51.100.20");
  const expressIp = clientIp({ ip: "::ffff:198.51.100.8", headers: {}, socket: { remoteAddress: "10.0.0.1" } });
  assert.equal(expressIp, "198.51.100.8");
});

test("in-memory rate limit still enforces a window", () => {
  _resetRateLimitMemory();
  assert.equal(rateLimit("t:a", 2, 60_000).ok, true);
  assert.equal(rateLimit("t:a", 2, 60_000).ok, true);
  assert.equal(rateLimit("t:a", 2, 60_000).ok, false);
});

test("OAuth landing URL puts a short-lived code in the fragment, not the session token", async () => {
  _resetAuthTickets();
  process.env.SESSION_SECRET ||= "test-session-secret-for-tickets-32bytes!!";
  const code = await issueAuthTicket({ id: "00000000-0000-0000-0000-000000000001" }, { returnPath: "/dashboard" });
  const url = sessionLandingUrl(code, "/dashboard", "https://ghostchat.pro");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://ghostchat.pro");
  assert.equal(parsed.searchParams.get("token"), null);
  assert.equal(parsed.hash, `#gc_code=${encodeURIComponent(code)}`);
  const first = await redeemAuthTicket(code);
  assert.ok(first);
  assert.equal(first.ownerId, "00000000-0000-0000-0000-000000000001");
  assert.equal(await redeemAuthTicket(code), null);
});

test("widget cache is short unless the URL is versioned", () => {
  assert.equal(widgetCacheControl(""), "public, max-age=60, must-revalidate");
  assert.equal(widgetCacheControl("abc123"), "public, max-age=31536000, immutable");
});

test("landing page plans mention live chat and top-ups, and FAQ explains helpful mode", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Live human handoff \(Discord, Telegram or dashboard inbox\)/);
  assert.match(html, /£5<\/b> for 1,000 credits/);
  assert.match(html, /£15<\/b> for 5,000/);
  assert.match(html, /default <b>Helpful<\/b> mode/);
  assert.match(html, /Switch a bot to <b>Strict<\/b>/);
  assert.match(html, /\.plans \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.doesNotMatch(html, /examples, \.plans, \.mini \{ grid-template-columns: 1fr 1fr; \}/);
});

test("login form is visible without JavaScript", () => {
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(html, /<section id="auth" class="auth">/);
  assert.doesNotMatch(html, /id="auth" class="auth hidden"/);
  assert.match(html, /id="app" class="app hidden"/);
});
