import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }
  const v4 = ip.includes(":") && ip.includes(".") ? ip.split(":").pop()! : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("That host is not allowed");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private or local addresses are not allowed");
    return url;
  }
  const results = await lookup(host, { all: true });
  if (!results.length) throw new Error("Could not resolve host");
  for (const row of results) {
    if (isPrivateIp(row.address)) {
      throw new Error("Private or local addresses are not allowed");
    }
  }
  return url;
}

export function sameOrigin(base: URL, href: string): URL | null {
  try {
    const next = new URL(href, base);
    if (next.protocol !== "http:" && next.protocol !== "https:") return null;
    if (next.host !== base.host) return null;
    next.hash = "";
    return next;
  } catch {
    return null;
  }
}
