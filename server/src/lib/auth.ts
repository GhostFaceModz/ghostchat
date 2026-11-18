import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { getDb } from "./supabase.js";
import type { Owner } from "../types.js";
import { resolveWorkspace, type TeamRole } from "./team.js";

const scrypt = promisify(scryptCb);
const SCRYPT_KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const key = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

type TokenPayload = { sub: string; email: string; name: string | null; exp: number; iat?: number };

/** "Remember me" sessions last about 30 days; unticked ones last a day and live in sessionStorage. */
export const REMEMBER_TTL = 60 * 60 * 24 * 30;
export const SESSION_TTL = 60 * 60 * 24;
export function sessionTtl(remember: unknown): number {
  return remember === false || remember === "false" || remember === "0" ? SESSION_TTL : REMEMBER_TTL;
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

export function signToken(owner: Owner, ttlSeconds = REMEMBER_TTL): string {
  if (!config.sessionSecret) throw new Error("SESSION_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", config.sessionSecret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  if (!config.sessionSecret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(createHmac("sha256", config.sessionSecret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newSiteKey(): string {
  return `gc_${randomBytes(18).toString("base64url")}`;
}

export type AuthedRequest = Request & { owner: Owner; workspaceId: string; role: TeamRole };

export function workspaceId(req: Request): string {
  const a = req as AuthedRequest;
  return a.workspaceId || a.owner.id;
}

export function teamRole(req: Request): TeamRole {
  return (req as AuthedRequest).role || "owner";
}

export function denyIfNotOwner(req: Request, res: Response): boolean {
  if (teamRole(req) === "owner") return false;
  res.status(403).json({ error: "You need to be the account owner to change this." });
  return true;
}

export function denyIfViewer(req: Request, res: Response): boolean {
  if (teamRole(req) !== "viewer") return false;
  res.status(403).json({ error: "Viewers can look, but can't send or edit." });
  return true;
}


export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "Please sign in" });
    return;
  }
  // Deleted accounts and "sign out of all devices" invalidate existing tokens.
  getDb()
    .from("ghostchat_owners")
    .select("id, email, name, sessions_valid_after, discord_id, agent_display_name")
    .eq("id", payload.sub)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) return res.status(503).json({ error: "Please try again in a moment." });
      const cutoff = data?.sessions_valid_after ? Math.floor(new Date(data.sessions_valid_after).getTime() / 1000) : 0;
      if (!data || (payload.iat ?? 0) < cutoff) return res.status(401).json({ error: "Please sign in" });
      const owner = { id: data.id, email: data.email, name: data.name, discord_id: data.discord_id, agent_display_name: data.agent_display_name };
      const requested = req.header("x-ghostchat-workspace") || "";
      resolveWorkspace(data.id, requested).then((ws) => {
        (req as AuthedRequest).owner = owner;
        (req as AuthedRequest).workspaceId = ws.workspaceId;
        (req as AuthedRequest).role = ws.role;
        next();
      }, (err: Error & { status?: number }) => {
        const status = err.status === 403 ? 403 : 503;
        res.status(status).json({ error: status === 403 ? err.message : "Please try again in a moment." });
      });
    }, () => res.status(503).json({ error: "Please try again in a moment." }));
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function signOAuthState(
  provider: string,
  opts?: { ttlSeconds?: number; returnPath?: string },
): string {
  if (!config.sessionSecret) throw new Error("SESSION_SECRET is not set");
  const ttlSeconds = opts?.ttlSeconds ?? 600;
  const body = b64url(JSON.stringify({
    p: provider,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    n: randomBytes(8).toString("hex"),
    r: opts?.returnPath,
  }));
  const sig = b64url(createHmac("sha256", config.sessionSecret).update(body).digest());
  return `${body}.${sig}`;
}

export function readOAuthState(token: string, provider: string): { returnPath?: string } | null {
  const payload = verifyTokenLike(token);
  if (!payload || payload.p !== provider || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { returnPath: typeof payload.r === "string" ? payload.r : undefined };
}

export function verifyOAuthState(token: string, provider: string): boolean {
  return Boolean(readOAuthState(token, provider));
}

function verifyTokenLike(token: string): { p?: string; exp: number; r?: string } | null {
  if (!config.sessionSecret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(createHmac("sha256", config.sessionSecret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
