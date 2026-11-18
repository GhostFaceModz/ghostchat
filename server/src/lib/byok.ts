/** Bring-your-own-key: AES-256-GCM at rest, never logged, Pro/Business only. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb } from "./supabase.js";
import type { ProviderId } from "./models.js";

const PROVIDERS: ProviderId[] = ["openrouter", "openai", "gemini", "grok"];

export function byokConfigured(): boolean {
  return Boolean(encryptionKey());
}

function encryptionKey(): Buffer | null {
  const raw = (process.env.BYOK_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  // Derive a 32-byte key so a long passphrase still works; do not log the input.
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error("BYOK is not configured on this server."), { status: 503 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([nonce, enc, tag]).toString("base64");
}

export function decryptSecret(packed: string): string {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error("BYOK is not configured on this server."), { status: 503 });
  if (!packed.startsWith("v1:")) throw new Error("Unsupported key encoding.");
  const buf = Buffer.from(packed.slice(3), "base64");
  if (buf.length < 29) throw new Error("Corrupt key material.");
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return "••••" + trimmed.slice(-4);
}

export function looksLikeApiKey(provider: ProviderId, secret: string): boolean {
  const s = secret.trim();
  if (s.length < 16 || s.length > 256) return false;
  if (/\s/.test(s)) return false;
  if (provider === "openai" && !/^sk-/.test(s)) return false;
  if (provider === "openrouter" && !/^sk-or-/.test(s) && !/^sk-/.test(s)) return false;
  return true;
}

export type PublicOwnerKey = { provider: ProviderId; hint: string; updated_at: string };

export async function listOwnerKeys(ownerId: string): Promise<PublicOwnerKey[]> {
  const { data, error } = await getDb()
    .from("ghostchat_owner_keys")
    .select("provider, key_hint, updated_at")
    .eq("owner_id", ownerId);
  if (error) throw error;
  return (data || []).map((r: { provider: string; key_hint: string | null; updated_at: string }) => ({
    provider: r.provider as ProviderId,
    hint: r.key_hint || "••••",
    updated_at: r.updated_at,
  }));
}

export async function upsertOwnerKey(ownerId: string, provider: ProviderId, secret: string): Promise<PublicOwnerKey> {
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error("That provider is not supported."), { status: 400 });
  }
  const trimmed = secret.trim();
  if (!looksLikeApiKey(provider, trimmed)) {
    throw Object.assign(new Error("That does not look like a valid API key."), { status: 400 });
  }
  const ciphertext = encryptSecret(trimmed);
  const hint = keyHint(trimmed);
  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from("ghostchat_owner_keys")
    .upsert({ owner_id: ownerId, provider, ciphertext, key_hint: hint, updated_at: now }, { onConflict: "owner_id,provider" })
    .select("provider, key_hint, updated_at")
    .single();
  if (error) throw error;
  return { provider, hint: data.key_hint || hint, updated_at: data.updated_at };
}

export async function deleteOwnerKey(ownerId: string, provider: ProviderId): Promise<void> {
  const { error } = await getDb().from("ghostchat_owner_keys").delete().eq("owner_id", ownerId).eq("provider", provider);
  if (error) throw error;
}

/** Decrypt keys for inference. Callers must not log the returned values. */
export async function loadOwnerKeyMap(ownerId: string | null | undefined): Promise<Partial<Record<ProviderId, string>>> {
  if (!ownerId || !byokConfigured()) return {};
  const { data, error } = await getDb().from("ghostchat_owner_keys").select("provider, ciphertext").eq("owner_id", ownerId);
  if (error || !data?.length) return {};
  const out: Partial<Record<ProviderId, string>> = {};
  for (const row of data as Array<{ provider: ProviderId; ciphertext: string }>) {
    try {
      out[row.provider] = decryptSecret(row.ciphertext);
    } catch {
      // Skip a key that will not decrypt rather than failing the chat.
    }
  }
  return out;
}

export function isByokPlan(plan?: string | null): boolean {
  return plan === "pro" || plan === "business";
}
