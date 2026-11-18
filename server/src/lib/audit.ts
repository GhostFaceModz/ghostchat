/** Workspace audit log: actions and targets only, never chat messages or secrets. */
import type { Request } from "express";
import { getDb } from "./supabase.js";
import type { AuthedRequest } from "./auth.js";

const BLOCKED_KEYS = /^(message|content|answer|question|text|body|token|secret|password|authorization|api[_-]?key|inviteurl|snippet|email_inbound_token|site_key|staging_site_key|byok|private_key)$/i;

export function sanitizeMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (BLOCKED_KEYS.test(k)) continue;
    if (typeof v === "string") {
      if (/gc_(stg_)?[A-Za-z0-9_-]{8,}/.test(v)) continue;
      out[k] = v.slice(0, 200);
    } else if (typeof v === "number" || typeof v === "boolean" || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20).map((item) => (typeof item === "string" ? item.slice(0, 120) : item)).filter((item) => typeof item !== "object");
    }
  }
  return out;
}

export async function writeAudit(opts: {
  workspaceId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await getDb().from("ghostchat_audit_log").insert({
    workspace_id: opts.workspaceId,
    actor_id: opts.actorId || null,
    actor_email: (opts.actorEmail || "").slice(0, 200) || null,
    action: opts.action.slice(0, 80),
    target_type: opts.targetType || null,
    target_id: opts.targetId ? String(opts.targetId).slice(0, 80) : null,
    meta: sanitizeMeta(opts.meta),
  });
  if (error) console.error("audit log:", error.message);
}

export async function auditFromReq(
  req: Request,
  action: string,
  opts: { targetType?: string; targetId?: string | null; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const a = req as AuthedRequest;
  const workspaceId = a.workspaceId || a.owner?.id;
  if (!workspaceId) return;
  await writeAudit({
    workspaceId,
    actorId: a.owner?.id,
    actorEmail: a.owner?.email,
    action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    meta: opts.meta,
  });
}

export async function listAudit(workspaceId: string, limit = 50) {
  const { data, error } = await getDb()
    .from("ghostchat_audit_log")
    .select("id, actor_email, action, target_type, target_id, meta, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return data ?? [];
}
