import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./supabase.js";

export const API_KEY_PREFIX = "gcsk_";
const MAX_KEYS = 5;

export type PublicApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

export function looksLikeApiKey(raw: string): boolean {
  return new RegExp("^" + API_KEY_PREFIX + "[a-f0-9]{64}$").test(String(raw || "").trim());
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString("hex");
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, API_KEY_PREFIX.length + 8) + "…" };
}

export function parsePresentedKey(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }): string | null {
  const header = String(req.headers.authorization || req.headers.Authorization || "").trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(header);
  const raw = (bearer && bearer[1]) || String(req.headers["x-api-key"] || req.headers["X-Api-Key"] || "").trim();
  if (!looksLikeApiKey(raw)) return null;
  return raw;
}

export async function listApiKeys(siteId: string): Promise<PublicApiKey[]> {
  const { data, error } = await getDb()
    .from("ghostchat_api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("site_id", siteId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PublicApiKey[];
}

export async function createApiKey(siteId: string, name?: string): Promise<{ raw: string; key: PublicApiKey }> {
  const existing = await listApiKeys(siteId);
  if (existing.length >= MAX_KEYS) throw Object.assign(new Error("You already have the maximum of 5 API keys for this site."), { status: 400 });
  const label = String(name || "Search key").replace(/\s+/g, " ").trim().slice(0, 60) || "Search key";
  const made = generateApiKey();
  const { data, error } = await getDb()
    .from("ghostchat_api_keys")
    .insert({ site_id: siteId, name: label, key_prefix: made.prefix, key_hash: made.hash })
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .single();
  if (error) throw error;
  return { raw: made.raw, key: data as PublicApiKey };
}

export async function revokeApiKey(siteId: string, keyId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("ghostchat_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("site_id", siteId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function resolveApiKey(raw: string): Promise<{ id: string; site_id: string } | null> {
  if (!looksLikeApiKey(raw)) return null;
  const hash = hashApiKey(raw);
  const { data } = await getDb()
    .from("ghostchat_api_keys")
    .select("id, site_id, key_hash, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  const a = Buffer.from(String(data.key_hash), "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  getDb().from("ghostchat_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {}, () => {});
  return { id: data.id, site_id: data.site_id };
}

export function clampTopK(value: unknown, fallback = 5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(1, Math.round(n)));
}
