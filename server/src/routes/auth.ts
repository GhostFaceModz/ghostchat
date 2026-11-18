import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { hashPassword, verifyPassword, signToken, sessionTtl, isValidEmail, requireAuth, signOAuthState, verifyOAuthState, readOAuthState, type AuthedRequest } from "../lib/auth.js";
import { listWorkspaces } from "../lib/team.js";
import { mailerConfigured } from "../lib/mailer.js";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import { issueAuthTicket, mintSessionFromTicket, sessionLandingUrl } from "../lib/authTickets.js";
import { config, oauthConfigured, oauthMode, supabaseAuthorizeUrl, PLAN_LIMITS, type Plan } from "../config.js";
import { exchangeDiscordCode, exchangeGoogleCode, profileFromSupabaseUser, upsertOwnerFromOAuth } from "../lib/oauth.js";
import {
  buildGoogleAuthorizeUrl,
  createGoogleHandoff,
  googleCallbackUrl,
  googleFinishUrl,
  needsGoogleHandoff,
  redeemGoogleHandoff,
  safeReturnPath,
} from "../lib/googleHandoff.js";
export const authRouter = Router();

// Which sign-in methods are live and where each button should go. Direct OAuth (own client
// secret) wins when configured; otherwise sign-in runs through Supabase Auth on the shared project.
authRouter.get("/providers", (_req, res) => {
  const discord = oauthMode("discord");
  const google = oauthMode("google");
  const startUrl = (p: "discord" | "google", mode: typeof discord) =>
    mode === "supabase" ? supabaseAuthorizeUrl(p) : mode === "direct" ? `/api/auth/${p}` : null;
  res.json({
    providers: { discord: Boolean(discord), google: Boolean(google), password: true },
    modes: { discord, google },
    urls: { discord: startUrl("discord", discord), google: startUrl("google", google) },
    redirectUris: {
      discord: discord === "supabase" ? `${config.publicUrl}/auth/callback` : `${config.publicUrl}/api/auth/discord/callback`,
      google: google === "supabase" ? `${config.publicUrl}/auth/callback` : googleCallbackUrl(),
    },
  });
});

// Exchange a Supabase Auth access token (from /auth/callback) for a GhostChat session.

// Exchange a short-lived one-time auth code (from the URL fragment after OAuth) for a session token.
authRouter.post("/exchange", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`auth-exchange:${ip}`, 30, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });
  const code = String(req.body?.code || req.body?.auth_code || "").trim();
  const minted = await mintSessionFromTicket(code);
  if (!minted) return res.status(401).json({ error: "That sign-in has expired. Please try again." });
  const { data } = await getDb().from("ghostchat_owners").select("id, email, name, plan, avatar_url").eq("id", minted.ownerId).maybeSingle();
  res.setHeader("cache-control", "no-store");
  res.json({ token: minted.token, remember: minted.remember, returnPath: minted.returnPath, owner: data || null });
});

authRouter.post("/supabase", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`supabase-auth:${ip}`, 20, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });
  const accessToken = String(req.body?.access_token || "").trim();
  if (!accessToken || accessToken.length > 8192 || accessToken.split(".").length !== 3) {
    return res.status(400).json({ error: "Missing or malformed sign-in token." });
  }
  const { data, error } = await getDb().auth.getUser(accessToken);
  if (error || !data?.user) {
    return res.status(401).json({ error: "That sign-in has expired or is invalid. Please try again." });
  }
  try {
    const profile = profileFromSupabaseUser(data.user);
    const { owner, token } = await upsertOwnerFromOAuth(profile);
    res.json({ token, owner });
  } catch (e) {
    console.error("supabase auth:", (e as Error).message);
    res.status(400).json({ error: "Sign-in failed. Please try again." });
  }
});

authRouter.post("/signup", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`signup:${ip}`, 8, 15 * 60 * 1000);
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

  const token = signToken({ id: data.id, email: data.email, name: data.name }, sessionTtl(req.body?.remember));
  res.status(201).json({ token, owner: data });
});

authRouter.post("/login", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`login:${ip}`, 12, 15 * 60 * 1000);
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
  const token = signToken(owner, sessionTtl(req.body?.remember));
  res.json({ token, owner });
});

function oauthRedirect(provider: "discord" | "google", error: string) {
  // Only pre-approved, user-safe messages are passed through the query string.
  const safe = error.replace(/[^\w .,'’-]/g, " ").trim().slice(0, 160) || "Sign-in failed. Please try again.";
  return `${config.publicUrl}/dashboard?auth_error=${encodeURIComponent(safe)}&provider=${provider}`;
}
async function oauthSuccess(owner: { id: string }, returnPath = "/dashboard", remember = true) {
  const code = await issueAuthTicket(owner, { remember, returnPath: safeReturnPath(returnPath) });
  return sessionLandingUrl(code, safeReturnPath(returnPath), config.publicUrl);
}

authRouter.get("/discord", (_req, res) => {
  if (oauthMode("discord") === "supabase") return res.redirect(supabaseAuthorizeUrl("discord"));
  if (!oauthConfigured("discord")) {
    return res.status(501).json({ error: "Discord sign-in is not configured." });
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
    const { owner } = await upsertOwnerFromOAuth(profile);
    res.redirect(await oauthSuccess(owner));
  } catch (e) {
    console.error("discord oauth:", (e as Error).message);
    res.redirect(oauthRedirect("discord", "Discord sign-in failed. Please try again."));
  }
});

authRouter.get("/google", (req, res) => {
  if (oauthMode("google") === "supabase") return res.redirect(supabaseAuthorizeUrl("google"));
  if (!oauthConfigured("google")) {
    return res.status(501).json({ error: "Google sign-in is not configured." });
  }
  const returnPath = safeReturnPath(req.query.next ?? req.query.return);
  const redirectUri = googleCallbackUrl();
  const state = signOAuthState("google", { returnPath });
  res.redirect(buildGoogleAuthorizeUrl(config.googleClientId, redirectUri, state));
});

authRouter.get("/google/callback", async (req, res) => {
  const err = String(req.query.error || "");
  if (err) return res.redirect(oauthRedirect("google", "Google sign-in was cancelled."));
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const statePayload = readOAuthState(state, "google");
  if (!code || !statePayload) {
    return res.redirect(oauthRedirect("google", "Google sign-in expired. Please try again."));
  }
  try {
    const redirectUri = googleCallbackUrl();
    const profile = await exchangeGoogleCode(code, redirectUri);
    const { owner, token } = await upsertOwnerFromOAuth(profile);
    const returnPath = safeReturnPath(statePayload.returnPath);
    if (needsGoogleHandoff()) {
      const ticket = createGoogleHandoff(token, returnPath);
      return res.redirect(googleFinishUrl(ticket));
    }
    res.redirect(await oauthSuccess(owner, returnPath));
  } catch (e) {
    console.error("google oauth:", (e as Error).message);
    res.redirect(oauthRedirect("google", "Google sign-in failed. Please try again."));
  }
});

authRouter.get("/google/finish", async (req, res) => {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`google-finish:${ip}`, 30, 15 * 60 * 1000);
  if (!rl.ok) return res.redirect(oauthRedirect("google", "Too many sign-in attempts. Try again shortly."));
  const ticket = String(req.query.t || "");
  const handoff = redeemGoogleHandoff(ticket);
  if (!handoff) {
    return res.redirect(oauthRedirect("google", "Google sign-in expired. Please try again."));
  }
  // Exchange the in-memory handoff for a short-lived auth code in the URL fragment (not the session token).
  const minted = await mintSessionFromHandoffToken(handoff.sessionToken, safeReturnPath(handoff.returnPath));
  if (!minted) {
    return res.redirect(oauthRedirect("google", "Google sign-in expired. Please try again."));
  }
  res.redirect(minted);
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const actor = (req as AuthedRequest).owner;
  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("id, email, name, plan, avatar_url, discord_id, google_id, whop_membership_id, is_admin, password_hash, created_at, agent_display_name")
    .eq("id", actor.id)
    .maybeSingle();
  if (error || !data) return res.status(401).json({ error: "Please sign in" });
  const plan = (data.plan as Plan) || "free";
  const session = req as AuthedRequest;
  const workspaces = await listWorkspaces(data.id, { email: data.email, name: data.name, plan }).catch(() => []);
  res.json({
    owner: {
      id: data.id,
      email: data.email,
      name: data.name,
      plan,
      avatar_url: data.avatar_url,
      discord_linked: Boolean(data.discord_id),
      google_linked: Boolean(data.google_id),
      agent_display_name: data.agent_display_name || null,
      is_admin: Boolean(data.is_admin),
      has_password: Boolean(data.password_hash),
      created_at: data.created_at,
    },
    limits: PLAN_LIMITS[plan],
    workspaceId: session.workspaceId || data.id,
    role: session.role || "owner",
    workspaces,
    mailer: mailerConfigured(),
    billing: {
      configured: Boolean(config.whopWebhookSecret || config.whopCheckoutProUrl),
      membership: Boolean(data.whop_membership_id),
    },
  });
});

// ---- My account ----
authRouter.patch("/me", requireAuth, async (req, res) => {
  const { id } = (req as AuthedRequest).owner;
  const name = String(req.body?.name ?? "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Enter a name." });
  const { error } = await getDb().from("ghostchat_owners").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return res.status(500).json({ error: "Could not save your name." });
  res.json({ ok: true, name });
});

authRouter.post("/password", requireAuth, async (req, res) => {
  const { id } = (req as AuthedRequest).owner;
  const rl = await rateLimitAsync(`pw:${id}`, 8, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many attempts. Try again shortly." });
  const current = String(req.body?.current_password || "");
  const next = String(req.body?.new_password || "");
  if (next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  const db = getDb();
  const { data } = await db.from("ghostchat_owners").select("password_hash").eq("id", id).maybeSingle();
  if (!data?.password_hash) return res.status(400).json({ error: "This account signs in with Discord or Google, so it has no password to change." });
  if (!(await verifyPassword(current, data.password_hash))) return res.status(401).json({ error: "Your current password isn't right." });
  // Changing the password signs out every other session; this device gets a fresh token.
  const now = new Date();
  const { error } = await db
    .from("ghostchat_owners")
    .update({ password_hash: await hashPassword(next), sessions_valid_after: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", id);
  if (error) return res.status(500).json({ error: "Could not change the password." });
  const owner = (req as AuthedRequest).owner;
  res.json({ ok: true, token: signToken(owner, sessionTtl(req.body?.remember)) });
});

authRouter.post("/logout-all", requireAuth, async (req, res) => {
  const { id } = (req as AuthedRequest).owner;
  const { error } = await getDb()
    .from("ghostchat_owners")
    .update({ sessions_valid_after: new Date(Date.now() + 1000).toISOString() })
    .eq("id", id);
  if (error) return res.status(500).json({ error: "Could not sign out everywhere." });
  res.json({ ok: true });
});

authRouter.delete("/me", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const confirm = String(req.body?.confirm_email || "").trim().toLowerCase();
  if (!confirm || confirm !== owner.email.toLowerCase()) {
    return res.status(400).json({ error: "Type your account email exactly to confirm." });
  }
  const db = getDb();
  const { data } = await db.from("ghostchat_owners").select("is_admin").eq("id", owner.id).maybeSingle();
  if (data?.is_admin) return res.status(403).json({ error: "The GhostChat owner (admin) account can't be deleted from the dashboard." });
  const { error } = await db.from("ghostchat_owners").delete().eq("id", owner.id);
  if (error) return res.status(500).json({ error: "Could not delete the account." });
  res.json({ ok: true });
});


async function mintSessionFromHandoffToken(sessionToken: string, returnPath: string): Promise<string | null> {
  const { verifyToken } = await import("../lib/auth.js");
  const payload = verifyToken(sessionToken);
  if (!payload) return null;
  const code = await issueAuthTicket({ id: payload.sub }, { remember: true, returnPath });
  return sessionLandingUrl(code, returnPath, config.publicUrl);
}

