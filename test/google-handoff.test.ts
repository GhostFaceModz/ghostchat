import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleAuthorizeUrl,
  createGoogleHandoff,
  googleCallbackUrl,
  googleFinishUrl,
  needsGoogleHandoff,
  redeemGoogleHandoff,
  safeReturnPath,
  _resetGoogleHandoffs,
} from "../server/src/lib/googleHandoff.js";
import { signOAuthState, readOAuthState, verifyOAuthState } from "../server/src/lib/auth.js";

const PUBLIC = "https://ghostchat.pro";
const ONRENDER = "https://ghostchat-nfoc.onrender.com";

test("Google callback URI is always the configured redirect base, not PUBLIC_URL", () => {
  assert.equal(googleCallbackUrl(ONRENDER), `${ONRENDER}/api/auth/google/callback`);
  assert.equal(googleCallbackUrl("https://ghostchat-nfoc.onrender.com/"), `${ONRENDER}/api/auth/google/callback`);
  assert.notEqual(googleCallbackUrl(ONRENDER), `${PUBLIC}/api/auth/google/callback`);
});

test("authorize URL sent to Google uses the onrender redirect_uri", () => {
  const state = signOAuthState("google", { returnPath: "/dashboard" });
  const url = new URL(buildGoogleAuthorizeUrl("client-id.apps.googleusercontent.com", googleCallbackUrl(ONRENDER), state));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("redirect_uri"), "https://ghostchat-nfoc.onrender.com/api/auth/google/callback");
  assert.equal(url.searchParams.get("client_id"), "client-id.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), state);
  assert.ok(verifyOAuthState(url.searchParams.get("state")!, "google"));
});

test("handoff is required when the Google callback host differs from PUBLIC_URL", () => {
  assert.equal(needsGoogleHandoff(ONRENDER, PUBLIC), true);
  assert.equal(needsGoogleHandoff(PUBLIC, PUBLIC), false);
  assert.equal(needsGoogleHandoff("http://localhost:3000", "http://localhost:3000"), false);
  assert.equal(needsGoogleHandoff("https://ghostchat.pro/", "https://ghostchat.pro"), false);
});

test("finish URL lands on the public origin with the one-time ticket", () => {
  const url = new URL(googleFinishUrl("ticket_abc", PUBLIC));
  assert.equal(url.origin, PUBLIC);
  assert.equal(url.pathname, "/api/auth/google/finish");
  assert.equal(url.searchParams.get("t"), "ticket_abc");
});

test("handoff ticket is single-use and returns the session plus return path", () => {
  _resetGoogleHandoffs();
  const id = createGoogleHandoff("session-token-1", "/dashboard");
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.ok(id.length >= 32);
  const first = redeemGoogleHandoff(id);
  assert.deepEqual(first, { sessionToken: "session-token-1", returnPath: "/dashboard" });
  assert.equal(redeemGoogleHandoff(id), null);
});

test("expired or unknown handoff tickets are rejected", async () => {
  _resetGoogleHandoffs();
  assert.equal(redeemGoogleHandoff(""), null);
  assert.equal(redeemGoogleHandoff("not-a-real-ticket"), null);
  const id = createGoogleHandoff("session-token-2", "/dashboard", 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(redeemGoogleHandoff(id), null);
});

test("return path allowlist rejects open redirects", () => {
  const ok = (raw: unknown, expected = "/dashboard") => assert.equal(safeReturnPath(raw, PUBLIC), expected);
  ok("/dashboard");
  ok("/dashboard?tab=sites", "/dashboard?tab=sites");
  ok(undefined);
  ok("");
  ok("/dashboard/../");
  ok("//evil.example");
  ok("https://evil.example/");
  ok("https://evil.example/dashboard");
  ok("/\\evil.example");
  ok("/dashboard/../../https://evil.example");
  ok("//ghostchat.pro/dashboard");
  ok("/auth/callback");
  ok("/login");
  ok("dashboard");
  ok("///evil.example");
  ok("/dashboard/@evil");
  ok("/dashboard\r\nLocation: https://evil.example");
});

test("OAuth state carries the return path and still validates CSRF across hosts", () => {
  const state = signOAuthState("google", { returnPath: "/dashboard?tab=sites" });
  const payload = readOAuthState(state, "google");
  assert.ok(payload);
  assert.equal(payload!.returnPath, "/dashboard?tab=sites");
  assert.equal(verifyOAuthState(state, "google"), true);
  assert.equal(verifyOAuthState(state, "discord"), false);
  assert.equal(verifyOAuthState("tampered." + state.split(".")[1], "google"), false);
  assert.equal(readOAuthState(signOAuthState("google", { ttlSeconds: -1, returnPath: "/dashboard" }), "google"), null);
});

test("Discord-style signOAuthState(provider) still verifies", () => {
  const state = signOAuthState("discord");
  assert.equal(verifyOAuthState(state, "discord"), true);
  assert.equal(verifyOAuthState(state, "google"), false);
});

test("finish endpoint rejects a bad ticket and does not set a session", async () => {
  const { default: express } = await import("express");
  const { authRouter } = await import("../server/src/routes/auth.js");
  const app = express();
  app.use("/api/auth", authRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/google/finish?t=bogus-ticket`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const loc = res.headers.get("location") || "";
    assert.match(loc, /\/dashboard\?/);
    assert.match(loc, /auth_error=/);
    assert.equal(new URL(loc).searchParams.get("token"), null);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("finish endpoint redeems a valid ticket then rejects reuse", async () => {
  const { default: express } = await import("express");
  const { authRouter } = await import("../server/src/routes/auth.js");
  _resetGoogleHandoffs();
  const ticket = createGoogleHandoff("session-live-token", "/dashboard");
  const app = express();
  app.use("/api/auth", authRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    const first = await fetch(`http://127.0.0.1:${port}/api/auth/google/finish?t=${encodeURIComponent(ticket)}`, { redirect: "manual" });
    assert.equal(first.status, 302);
    const loc = new URL(first.headers.get("location") || "http://invalid");
    assert.equal(loc.pathname, "/dashboard");
    assert.equal(loc.searchParams.get("token"), "session-live-token");
    assert.equal(loc.searchParams.get("auth_error"), null);
    const second = await fetch(`http://127.0.0.1:${port}/api/auth/google/finish?t=${encodeURIComponent(ticket)}`, { redirect: "manual" });
    assert.equal(second.status, 302);
    const loc2 = new URL(second.headers.get("location") || "http://invalid");
    assert.match(loc2.searchParams.get("auth_error") || "", /expired/i);
    assert.equal(loc2.searchParams.get("token"), null);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
