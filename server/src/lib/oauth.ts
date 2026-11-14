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
};

export async function upsertOwnerFromOAuth(profile: OAuthProfile): Promise<{ owner: Owner; token: string }> {
  const email = profile.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("That sign-in account does not have an email address we can use.");
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
    name?: string;
    picture?: string;
  };
  return {
    provider: "google",
    providerId: user.id,
    email: user.email || "",
    name: user.name || null,
    avatarUrl: user.picture || null,
  };
}
