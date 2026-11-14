import { getDb } from "./supabase.js";
import { signToken, isValidEmail } from "./auth.js";
import { config, oauthConfigured } from "../config.js";
import type { Owner } from "../types.js";

export type OAuthProfile = {
  provider: "discord" | "google";
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** False when the provider says the email is unverified. Unverified emails never link or create owners. */
  emailVerified?: boolean;
};

export async function upsertOwnerFromOAuth(profile: OAuthProfile): Promise<{ owner: Owner; token: string }> {
  const email = profile.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("That sign-in account does not have an email address we can use.");
  }
  if (profile.emailVerified === false) {
    throw new Error(`Please verify your email address with ${profile.provider === "discord" ? "Discord" : "Google"} first, then try again.`);
  }
  const db = getDb();
  const idCol = profile.provider === "discord" ? "discord_id" : "google_id";

  const { data: byProvider } = await db
    .from("ghostchat_owners")
    .select("id, email, name, plan, avatar_url, discord_id, google_id")
    .eq(idCol, profile.providerId)
    .maybeSingle();

  const { data: byEmail } = byProvider
    ? { data: byProvider }
    : await db
        .from("ghostchat_owners")
        .select("id, email, name, plan, avatar_url, discord_id, google_id")
        .ilike("email", email)
        .maybeSingle();

  const patch = {
    email,
    name: profile.name,
    avatar_url: profile.avatarUrl,
    [idCol]: profile.providerId,
    updated_at: new Date().toISOString(),
  };

  let row = byEmail as Owner | null;
  if (row) {
    const { data, error } = await db
      .from("ghostchat_owners")
      .update({
        ...patch,
        name: row.name || profile.name,
        avatar_url: profile.avatarUrl || row.avatar_url,
      })
      .eq("id", row.id)
      .select("id, email, name, plan, avatar_url, discord_id, google_id")
      .single();
    if (error) throw error;
    row = data as Owner;
  } else {
    const { data, error } = await db
      .from("ghostchat_owners")
      .insert({ ...patch, plan: "free" })
      .select("id, email, name, plan, avatar_url, discord_id, google_id")
      .single();
    if (error) throw error;
    row = data as Owner;
  }

  const owner: Owner = {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: row.plan,
    avatar_url: row.avatar_url,
  };
  return { owner, token: signToken(owner) };
}

export async function exchangeDiscordCode(code: string, redirectUri: string): Promise<OAuthProfile> {
  if (!oauthConfigured("discord")) throw new Error("Discord sign-in is not configured.");
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error("Discord did not accept that sign-in.");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Discord did not return an access token.");
  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) throw new Error("Could not load the Discord profile.");
  const user = (await userRes.json()) as {
    id: string;
    email?: string | null;
    verified?: boolean;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : null;
  return {
    provider: "discord",
    providerId: user.id,
    email: user.email || "",
    name: user.global_name || user.username || null,
    avatarUrl,
    emailVerified: user.verified !== false,
  };
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<OAuthProfile> {
  if (!oauthConfigured("google")) throw new Error("Google sign-in is not configured.");
  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error("Google did not accept that sign-in.");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Google did not return an access token.");
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) throw new Error("Could not load the Google profile.");
  const user = (await userRes.json()) as {
    id: string;
    email?: string;
    verified_email?: boolean;
    name?: string;
    picture?: string;
  };
  return {
    provider: "google",
    providerId: user.id,
    email: user.email || "",
    name: user.name || null,
    avatarUrl: user.picture || null,
    emailVerified: user.verified_email !== false,
  };
}

type SupabaseIdentity = {
  provider?: string;
  id?: string;
  identity_data?: Record<string, unknown> | null;
};

/**
 * Turns a verified Supabase Auth user into an OAuthProfile. Provider IDs come from the
 * Discord/Google identity (the same IDs direct OAuth stores), so both paths link to one owner.
 */
export function profileFromSupabaseUser(user: {
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: SupabaseIdentity[] | null;
}): OAuthProfile {
  const identities = user.identities || [];
  const lastProvider = String(user.app_metadata?.provider || "");
  const identity =
    identities.find((i) => i.provider === lastProvider && (i.provider === "discord" || i.provider === "google")) ||
    identities.find((i) => i.provider === "discord" || i.provider === "google");
  if (!identity) throw new Error("Please sign in with Discord or Google.");
  const provider = identity.provider as "discord" | "google";
  const data = (identity.identity_data || {}) as Record<string, unknown>;
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const pick = (...vals: unknown[]) => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return null;
  };
  const providerId = pick(data.provider_id, data.sub, identity.id);
  if (!providerId) throw new Error("That sign-in did not include an account ID.");
  const customClaims = (data.custom_claims || meta.custom_claims || {}) as Record<string, unknown>;
  return {
    provider,
    providerId,
    email: pick(user.email, data.email, meta.email) || "",
    name: pick(customClaims.global_name, data.full_name, meta.full_name, data.name, meta.name),
    avatarUrl: pick(data.avatar_url, meta.avatar_url, data.picture, meta.picture),
    // Supabase copies the provider's verified flag into identity_data.email_verified.
    emailVerified: data.email_verified === false ? Boolean(user.email_confirmed_at) : true,
  };
}
