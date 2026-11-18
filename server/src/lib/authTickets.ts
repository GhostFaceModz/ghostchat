import { randomBytes } from "node:crypto";
import { getDb } from "./supabase.js";
import { signToken, sessionTtl } from "./auth.js";

const TTL_MS = 60_000;
type Ticket = { ownerId: string; remember: boolean; returnPath: string; expiresAt: number };
const memory = new Map<string, Ticket>();

function prune(now = Date.now()) {
  for (const [id, t] of memory) if (t.expiresAt <= now) memory.delete(id);
}

export function newTicketId(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueAuthTicket(
  owner: { id: string },
  opts: { remember?: boolean; returnPath?: string; ttlMs?: number } = {},
): Promise<string> {
  const id = newTicketId();
  const remember = opts.remember !== false;
  const returnPath = opts.returnPath || "/dashboard";
  const ttlMs = Math.max(1, opts.ttlMs ?? TTL_MS);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  memory.set(id, { ownerId: owner.id, remember, returnPath, expiresAt: Date.now() + ttlMs });
  if (process.env.NODE_ENV === "test" && process.env.RATE_LIMIT_DB !== "1") return id;
  try {
    await getDb().from("ghostchat_auth_tickets").insert({
      id,
      owner_id: owner.id,
      remember,
      return_path: returnPath,
      expires_at: expiresAt,
    });
  } catch {
    // Memory is enough for a 60s ticket on a single instance.
  }
  return id;
}

export async function redeemAuthTicket(id: string): Promise<{ ownerId: string; remember: boolean; returnPath: string } | null> {
  if (!id || id.length > 256) return null;
  prune();
  const mem = memory.get(id);
  if (mem) {
    memory.delete(id);
    if (Date.now() > mem.expiresAt) return null;
    try {
      await getDb().from("ghostchat_auth_tickets").update({ used_at: new Date().toISOString() }).eq("id", id);
    } catch { /* ignore */ }
    return { ownerId: mem.ownerId, remember: mem.remember, returnPath: mem.returnPath };
  }
  try {
    const db = getDb();
    const { data } = await db.from("ghostchat_auth_tickets").select("owner_id, remember, return_path, expires_at, used_at").eq("id", id).maybeSingle();
    if (!data || data.used_at) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    const { data: claimed, error } = await db.from("ghostchat_auth_tickets").update({ used_at: new Date().toISOString() }).eq("id", id).is("used_at", null).select("id").maybeSingle();
    if (error || !claimed) return null;
    return { ownerId: data.owner_id, remember: Boolean(data.remember), returnPath: data.return_path || "/dashboard" };
  } catch {
    return null;
  }
}

export function sessionLandingUrl(code: string, returnPath = "/dashboard", publicUrl = process.env.PUBLIC_URL || "https://ghostchat.pro"): string {
  const base = publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`;
  const url = new URL(returnPath.startsWith("/") ? returnPath : "/dashboard", base);
  url.hash = `gc_code=${encodeURIComponent(code)}`;
  return url.toString();
}

export async function mintSessionFromTicket(id: string): Promise<{ token: string; remember: boolean; returnPath: string; ownerId: string } | null> {
  const ticket = await redeemAuthTicket(id);
  if (!ticket) return null;
  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("id, email, name")
    .eq("id", ticket.ownerId)
    .maybeSingle();
  if (error || !data) return null;
  const token = signToken({ id: data.id, email: data.email, name: data.name }, sessionTtl(ticket.remember));
  return { token, remember: ticket.remember, returnPath: ticket.returnPath, ownerId: data.id };
}

export function _resetAuthTickets(): void {
  memory.clear();
}
