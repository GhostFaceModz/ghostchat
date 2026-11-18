import type { Request } from "express";
import { getDb } from "./supabase.js";

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

function memoryHit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number; count: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    const retryAfterMs = windowMs - (now - bucket.timestamps[0]);
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs, count: bucket.timestamps.length };
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfterMs: 0, count: bucket.timestamps.length };
}

function memoryPeek(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number; count: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  const live = bucket ? bucket.timestamps.filter((t) => now - t < windowMs) : [];
  if (live.length >= limit) return { ok: false, retryAfterMs: windowMs - (now - live[0]), count: live.length };
  return { ok: true, retryAfterMs: 0, count: live.length };
}

export function windowId(windowMs: number, now = Date.now()): bigint {
  return BigInt(Math.floor(now / windowMs));
}

function usePersistentLimits(): boolean {
  return process.env.NODE_ENV !== "test" || process.env.RATE_LIMIT_DB === "1";
}

async function dbHit(key: string, windowMs: number): Promise<number | null> {
  try {
    const { data, error } = await getDb().rpc("ghostchat_rate_hit", { p_key: key, p_window_id: Number(windowId(windowMs)) });
    if (error) return null;
    return Number(data ?? 0);
  } catch {
    return null;
  }
}

async function dbPeek(key: string, windowMs: number): Promise<number | null> {
  try {
    const { data, error } = await getDb().rpc("ghostchat_rate_peek", { p_key: key, p_window_id: Number(windowId(windowMs)) });
    if (error) return null;
    return Number(data ?? 0);
  } catch {
    return null;
  }
}

/** In-memory limiter (tests, and fallback if the database is unreachable). */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterMs: number } {
  return memoryHit(key, limit, windowMs);
}

export function peekRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  return memoryPeek(key, limit, windowMs);
}

/** Persistent limiter: atomic increment in ghostchat_rate_limits, memory fallback. */
export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; remaining: number; retryAfterMs: number }> {
  if (!usePersistentLimits()) return memoryHit(key, limit, windowMs);
  const count = await dbHit(key, windowMs);
  if (count == null) return memoryHit(key, limit, windowMs);
  if (count > limit) {
    const now = Date.now();
    const retryAfterMs = windowMs - (now % windowMs);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  return { ok: true, remaining: Math.max(0, limit - count), retryAfterMs: 0 };
}

export async function peekRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterMs: number }> {
  if (!usePersistentLimits()) return memoryPeek(key, limit, windowMs);
  const count = await dbPeek(key, windowMs);
  if (count == null) return memoryPeek(key, limit, windowMs);
  if (count >= limit) {
    const now = Date.now();
    return { ok: false, retryAfterMs: windowMs - (now % windowMs) };
  }
  return { ok: true, retryAfterMs: 0 };
}

/**
 * Client IP behind Cloudflare + Render.
 * Prefer CF-Connecting-IP (set by Cloudflare, not spoofable), then Express req.ip
 * (trust proxy), then the *last* X-Forwarded-For hop. Never trust the first XFF hop.
 */
export function clientIp(req: Pick<Request, "ip" | "headers" | "socket"> | { ip?: string; headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const headers = req.headers as Record<string, unknown>;
  const cf = headerValue(headers["cf-connecting-ip"]);
  if (cf) return stripIp(cf);
  if (typeof req.ip === "string" && req.ip.trim()) return stripIp(req.ip);
  const fwd = headerValue(headers["x-forwarded-for"]);
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return stripIp(parts[parts.length - 1]);
  }
  const sock = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  return sock ? stripIp(sock) : "unknown";
}

function headerValue(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
  return "";
}

function stripIp(ip: string): string {
  return ip.replace(/^::ffff:/, "").trim();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60 * 60 * 1000);
    if (!bucket.timestamps.length) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

/** Test-only. */
export function _resetRateLimitMemory(): void {
  buckets.clear();
}
