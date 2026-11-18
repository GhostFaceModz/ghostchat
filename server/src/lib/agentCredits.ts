/** Per-agent monthly caps for dashboard model use (copilot). Not applied to the visitor widget or the workspace owner. */
import type { Request } from "express";
import { teamRole, workspaceId, type AuthedRequest } from "./auth.js";
import { getDb } from "./supabase.js";

export function creditPeriod(now = new Date(), timeZone = "Europe/London"): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    if (y && m) return `${y}-${m}`;
  } catch { /* fall through */ }
  return now.toISOString().slice(0, 7);
}

export function normalizeCreditCap(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "none") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(10000, n);
}

export type AgentCreditState = { used: number; cap: number | null; period: string; remaining: number | null };

export function nextCreditState(row: { credit_cap: number | null; credits_used: number; credits_period: string | null }, period: string): AgentCreditState {
  const cap = row.credit_cap == null ? null : row.credit_cap;
  const used = row.credits_period === period ? row.credits_used || 0 : 0;
  return { used, cap, period, remaining: cap == null ? null : Math.max(0, cap - used) };
}

export async function consumeDashboardCredit(req: Request, cost = 1): Promise<AgentCreditState | null> {
  const authed = req as AuthedRequest;
  const role = teamRole(req);
  const ws = workspaceId(req);
  if (role === "owner" || authed.owner?.id === ws) return null;
  if (role !== "agent") return null;
  const period = creditPeriod();
  const db = getDb();
  const { data, error } = await db
    .from("ghostchat_team_members")
    .select("id, credit_cap, credits_used, credits_period")
    .eq("workspace_id", ws)
    .eq("member_id", authed.owner.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const state = nextCreditState(data, period);
  if (state.cap == null) return state;
  const nextUsed = state.used + Math.max(1, Math.floor(cost) || 1);
  if (state.used >= state.cap) {
    throw Object.assign(new Error("This teammate has reached their monthly copilot credit cap."), { status: 402 });
  }
  const { error: upErr } = await db
    .from("ghostchat_team_members")
    .update({ credits_used: nextUsed, credits_period: period, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  if (upErr) throw upErr;
  return { ...state, used: nextUsed, remaining: Math.max(0, state.cap - nextUsed) };
}

export async function setMemberCreditCap(workspaceId: string, memberId: string, cap: number | null) {
  const { data, error } = await getDb()
    .from("ghostchat_team_members")
    .update({ credit_cap: cap, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", memberId)
    .neq("status", "revoked")
    .select("id, email, role, status, credit_cap, credits_used, credits_period")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Teammate not found."), { status: 404 });
  return data;
}
