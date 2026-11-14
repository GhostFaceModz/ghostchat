import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import type { Owner } from "../types.js";

const scrypt = promisify(scryptCb);
const SCRYPT_KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const key = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

type TokenPayload = { sub: string; email: string; name: string | null; exp: number };

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

export function signToken(owner: Owner, ttlSeconds = 60 * 60 * 24 * 14): string {
  if (!config.sessionSecret) throw new Error("SESSION_SECRET is not set");
  const payload: TokenPayload = {
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
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

export type AuthedRequest = Request & { owner: Owner };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "Please sign in" });
    return;
  }
  (req as AuthedRequest).owner = { id: payload.sub, email: payload.email, name: payload.name };
  next();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
