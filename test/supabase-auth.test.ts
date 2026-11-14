import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFromSupabaseUser } from "../server/src/lib/oauth.js";
import { supabaseAuthorizeUrl } from "../server/src/config.js";

test("Discord identity from Supabase maps to the Discord user id, email, global name and avatar", () => {
  const p = profileFromSupabaseUser({
    email: "Zane@Example.com",
    app_metadata: { provider: "discord" },
    user_metadata: { full_name: "zane_user", avatar_url: "https://cdn.discordapp.com/a.png" },
    identities: [
      { provider: "discord", id: "803606154365632555", identity_data: { provider_id: "803606154365632555", custom_claims: { global_name: "Zane" } } },
    ],
  });
  assert.equal(p.provider, "discord");
  assert.equal(p.providerId, "803606154365632555");
  assert.equal(p.email, "Zane@Example.com");
  assert.equal(p.name, "Zane");
  assert.equal(p.avatarUrl, "https://cdn.discordapp.com/a.png");
});

test("Google identity uses the Google sub and picks the last-used provider", () => {
  const p = profileFromSupabaseUser({
    email: "a@b.com",
    app_metadata: { provider: "google" },
    identities: [
      { provider: "discord", id: "1", identity_data: { provider_id: "1" } },
      { provider: "google", id: "1099", identity_data: { sub: "1099", name: "A B", picture: "https://x/y.png" } },
    ],
  });
  assert.equal(p.provider, "google");
  assert.equal(p.providerId, "1099");
  assert.equal(p.name, "A B");
});

test("users without a Discord/Google identity are rejected", () => {
  assert.throws(() => profileFromSupabaseUser({ email: "a@b.com", identities: [{ provider: "email", id: "x" }] }));
});

test("authorize URL points at Supabase with the GhostChat callback", () => {
  const u = new URL(supabaseAuthorizeUrl("discord"));
  assert.match(u.origin, /supabase\.co$/);
  assert.equal(u.pathname, "/auth/v1/authorize");
  assert.equal(u.searchParams.get("provider"), "discord");
  assert.ok(u.searchParams.get("redirect_to")!.endsWith("/auth/callback"));
});
