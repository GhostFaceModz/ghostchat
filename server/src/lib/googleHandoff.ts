import { randomBytes } from "node:crypto";
import { config } from "../config.js";

const HANDOFF_TTL_MS = 60_000;
const ALLOWED_RETURN_PATHS = new Set(["/dashboard"]);

type Handoff = {
  sessionToken: string;
  returnPath: string;
  expiresAt: number;
};

const handoffs = new Map<string, Handoff>();

export function googleCallbackUrl(redirectBase = config.googleRedirectBase): string {
  return `${redirectBase.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function originsEqual(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** True when Google will call back on a different host than PUBLIC_URL, so a handoff is required. */
export function needsGoogleHandoff(
  redirectBase = config.googleRedirectBase,
  publicUrl = config.publicUrl,
): boolean {
  return !originsEqual(redirectBase, publicUrl);
}

export function googleFinishUrl(oneTimeToken: string, publicUrl = config.publicUrl): string {
  const url = new URL("/api/auth/google/finish", publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`);
  url.searchParams.set("t", oneTimeToken);
  return url.toString();
}

export function buildGoogleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Only same-origin relative paths on the allowlist (currently /dashboard, with optional query). */
export function safeReturnPath(raw: unknown, publicUrl = config.publicUrl, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\") || /[\r\n]/.test(trimmed)) {
    return fallback;
  }
  let base: URL;
  try {
    base = new URL(publicUrl);
  } catch {
    return fallback;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base.origin) return fallback;
  if (parsed.username || parsed.password) return fallback;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
  if (!ALLOWED_RETURN_PATHS.has(parsed.pathname)) return fallback;
  return parsed.pathname + parsed.search;
}

function pruneHandoffs(now = Date.now()): void {
  for (const [id, entry] of handoffs) {
    if (entry.expiresAt <= now) handoffs.delete(id);
  }
}

export function createGoogleHandoff(
  sessionToken: string,
  returnPath: string,
  ttlMs = HANDOFF_TTL_MS,
): string {
  if (!sessionToken) throw new Error("Missing session token for Google handoff.");
  pruneHandoffs();
  const id = randomBytes(32).toString("base64url");
  handoffs.set(id, {
    sessionToken,
    returnPath: safeReturnPath(returnPath),
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
  return id;
}

export function redeemGoogleHandoff(id: string): { sessionToken: string; returnPath: string } | null {
  if (!id || id.length > 256) return null;
  const entry = handoffs.get(id);
  if (!entry) return null;
  handoffs.delete(id);
  if (Date.now() > entry.expiresAt) return null;
  return { sessionToken: entry.sessionToken, returnPath: entry.returnPath };
}

/** Test-only. */
export function _resetGoogleHandoffs(): void {
  handoffs.clear();
}
