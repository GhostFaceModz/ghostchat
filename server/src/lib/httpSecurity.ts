/** Host redirects, HSTS, and public-safe errors. No secrets, no raw Error.message to clients. */

export const CANONICAL_HOST = "ghostchat.pro";
export const LEGACY_RENDER_HOST = "ghostchat-nfoc.onrender.com";

/** Paths that must still be served on the legacy Render hostname until Google OAuth is moved. */
export function isLegacyGoogleCallbackPath(pathname: string): boolean {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return path === "/api/auth/google/callback";
}

/**
 * If this request hit the legacy onrender host, return the canonical URL to 301 to.
 * The Google OAuth callback is left on the legacy host until the Google Cloud client is updated.
 */
export function canonicalRedirect(host: string, originalUrl: string): string | null {
  const h = String(host || "").split(":")[0].toLowerCase();
  if (h !== LEGACY_RENDER_HOST) return null;
  const path = String(originalUrl || "/").split("?")[0];
  if (isLegacyGoogleCallbackPath(path)) return null;
  const suffix = originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`;
  return `https://${CANONICAL_HOST}${suffix}`;
}

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export const PUBLIC_ERROR = "Something went wrong. Please try again.";

export function publicErrorMessage(_err: unknown, fallback = PUBLIC_ERROR): string {
  void _err;
  return fallback;
}
