import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { hashPassword, verifyPassword, signToken, isValidEmail, requireAuth, signOAuthState, verifyOAuthState } from "../lib/auth.js";
import { clientIp, rateLimit } from "../lib/rateLimit.js";
import { config, oauthConfigured, PLAN_LIMITS, type Plan } from "../config.js";
import { exchangeDiscordCode, exchangeGoogleCode, upsertOwnerFromOAuth } from "../lib/oauth.js";
import type { AuthedRequest } from "../lib/auth.js";

export const authRouter = Router();

authRouter.get("/providers", (_req, res) => {
  res.json({
    providers: {
      discord: oauthConfigured("discord"),
      google: oauthConfigured("google"),
      password: true,
    },
  });
});

authRouter.post("/signup", async (req, res) => {
  const ip = clientIp(req);
  const rl = rateLimit(`signup:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-up attempts. Try again shortly." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim() || null;
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const db = getDb();
  const { data: existing } = await db.from("ghostchat_owners").select("id").ilike("email", email).maybeSingle();
  if (existing) return res.status(409).json({ error: "An account with that email already exists." });

  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("ghostchat_owners")
    .insert({ email, password_hash, name, plan: "free" })
    .select("id, email, name, plan, avatar_url")
    .single();
  if (error) return res.status(500).json({ error: "Could not create the account." });

  const token = signToken({ id: data.id, email: data.email, name: data.name });
  res.status(201).json({ token, owner: data });
});

authRouter.post("/login", async (req, res) => {
  const ip = clientIp(req);
  const rl = rateLimit(`login:${ip}`, 12, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("id, email, name, password_hash, plan, avatar_url")
    .ilike("email", email)
    .maybeSingle();
  if (error || !data || !data.password_hash || !(await verifyPassword(password, data.password_hash))) {
    return res.status(401).json({ error: "Those details don't match an account. If you signed up with Discord or Google, use that button instead." });
  }

  const owner = { id: data.id, email: data.email, name: data.name, plan: data.plan, avatar_url: data.avatar_url };
  const token = signToken(owner);
  res.json({ token, owner });
});

function oauthRedirect(provider: "discord" | "google", error: string) {
  return `${config.publicUrl}/dashboard?auth_error=${encodeURIComponent(error)}&provider=${provider}`;
}
function oauthSuccess(token: string) {
  return `${config.publicUrl}/dashboard?token=${encodeURIComponent(token)}`;
}

authRouter.get("/discord", (_req, res) => {
  if (!oauthConfigured("discord")) {
    return res.status(501).json({ error: "Discord sign-in is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET." });
  }
  const redirectUri = `${config.publicUrl}/api/auth/discord/callback`;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", signOAuthState("discord"));
  res.redirect(url.toString());
});

authRouter.get("/discord/callback", async (req, res) => {
  const err = String(req.query.error || "");
  if (err) return res.redirect(oauthRedirect("discord", "Discord sign-in was cancelled."));
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !verifyOAuthState(state, "discord")) {
    return res.redirect(oauthRedirect("discord", "Discord sign-in expired. Please try again."));
  }
  try {
    const profile = await exchangeDiscordCode(code, `${config.publicUrl}/api/auth/discord/callback`);
    const { token } = await upsertOwnerFromOAuth(profile);
    res.redirect(oauthSuccess(token));
  } catch (e) {
    res.redirect(oauthRedirect("discord", (e as Error).message || "Discord sign-in failed."));
  }
});

authRouter.get("/google", (_req, res) => {
  if (!oauthConfigured("google")) {
    return res.status(501).json({ error: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
  }
  const redirectUri = `${config.publicUrl}/api/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", signOAuthState("google"));
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

authRouter.get("/google/callback", async (req, res) => {
  const err = String(req.query.error || "");
  if (err) return res.redirect(oauthRedirect("google", "Google sign-in was cancelled."));
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !verifyOAuthState(state, "google")) {
    return res.redirect(oauthRedirect("google", "Google sign-in expired. Please try again."));
  }
  try {
    const profile = await exchangeGoogleCode(code, `${config.publicUrl}/api/auth/google/callback`);
    const { token } = await upsertOwnerFromOAuth(profile);
    res.redirect(oauthSuccess(token));
  } catch (e) {
    res.redirect(oauthRedirect("google", (e as Error).message || "Google sign-in failed."));
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const session = (req as AuthedRequest).owner;
  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("id, email, name, plan, avatar_url, discord_id, google_id, whop_membership_id")
    .eq("id", session.id)
    .maybeSingle();
  if (error || !data) return res.status(401).json({ error: "Please sign in" });
  const plan = (data.plan as Plan) || "free";
  res.json({
    owner: {
      id: data.id,
      email: data.email,
      name: data.name,
      plan,
      avatar_url: data.avatar_url,
      discord_linked: Boolean(data.discord_id),
      google_linked: Boolean(data.google_id),
    },
    limits: PLAN_LIMITS[plan],
    billing: {
      configured: Boolean(config.whopWebhookSecret || config.whopCheckoutProUrl),
      membership: Boolean(data.whop_membership_id),
    },
  });
});
