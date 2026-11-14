type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    const retryAfterMs = windowMs - (now - bucket.timestamps[0]);
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfterMs: 0 };
}

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd[0]) return String(fwd[0]).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Occasional cleanup so the map doesn't grow forever on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60 * 60 * 1000);
    if (!bucket.timestamps.length) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();
