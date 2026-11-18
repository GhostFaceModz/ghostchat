import { createHash, randomBytes } from "node:crypto";
import { PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "./supabase.js";
import { getOwnerPlan } from "./usage.js";

export type TeamRole = "owner" | "agent" | "viewer";
export type MemberRole = "agent" | "viewer";
export type MemberStatus = "pending" | "active" | "revoked";

export type TeamMember = {
  id: string;
  workspace_id: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  member_id: string | null;
  created_at: string;
  accepted_at: string | null;
  credit_cap?: number | null;
  credits_used?: number;
  credits_period?: string | null;
};

export function seatsFor(plan: Plan): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).maxSeats;
}

export function canUseDigest(plan: Plan): boolean {
  return Boolean((PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).digest);
}

export function canUseCopilot(plan: Plan): boolean {
  return Boolean((PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).copilot);
}

export function canUseEmailChannel(plan: Plan): boolean {
  return Boolean((PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).emailChannel);
}

export function isMemberRole(role: string): role is MemberRole {
  return role === "agent" || role === "viewer";
}

export function canWriteSettings(role: TeamRole): boolean {
  return role === "owner";
}

export function canAgentAct(role: TeamRole): boolean {
  return role === "owner" || role === "agent";
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function countSeatsUsed(workspaceId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("ghostchat_team_members")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["pending", "active"]);
  if (error) throw error;
  return 1 + (count ?? 0);
}

export async function listMembers(workspaceId: string): Promise<TeamMember[]> {
  const { data, error } = await getDb()
    .from("ghostchat_team_members")
    .select("id, workspace_id, email, role, status, member_id, created_at, accepted_at, credit_cap, credits_used, credits_period")
    .eq("workspace_id", workspaceId)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as TeamMember[];
}

export async function inviteMember(
  workspaceId: string,
  invitedBy: string,
  emailRaw: string,
  roleRaw: string,
): Promise<{ member: TeamMember; token: string; inviteUrl: string }> {
  const plan = await getOwnerPlan(workspaceId);
  const cap = seatsFor(plan);
  if (cap <= 1) {
    const err = new Error("Team seats are on Pro (2) and Business (5). Upgrade to invite teammates.");
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    const err = new Error("Enter a valid email address.");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const role: MemberRole = isMemberRole(roleRaw) ? roleRaw : "agent";
  const { data: owner } = await getDb().from("ghostchat_owners").select("email").eq("id", workspaceId).maybeSingle();
  if (owner?.email && String(owner.email).toLowerCase() === email) {
    const err = new Error("That's the account owner — no need to invite them.");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const { data: existing } = await getDb()
    .from("ghostchat_team_members")
    .select("id, workspace_id, email, role, status, member_id, created_at, accepted_at")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .maybeSingle();
  if (existing && existing.status === "active") {
    const err = new Error("That person is already on this workspace.");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
  const used = await countSeatsUsed(workspaceId);
  // A resend of a pending invite should not consume a second seat.
  const alreadyPending = existing && existing.status === "pending";
  if (!alreadyPending && used >= cap) {
    const err = new Error(`You've used all ${cap} seats on this plan.`);
    (err as Error & { status: number }).status = 402;
    throw err;
  }
  const token = newInviteToken();
  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from("ghostchat_team_members")
    .upsert({
      workspace_id: workspaceId,
      email,
      role,
      status: "pending",
      invite_token_hash: hashInviteToken(token),
      invited_by: invitedBy,
      member_id: null,
      accepted_at: null,
      updated_at: now,
    }, { onConflict: "workspace_id,email" })
    .select("id, workspace_id, email, role, status, member_id, created_at, accepted_at")
    .single();
  if (error || !data) {
    const err = new Error("Could not send that invite.");
    (err as Error & { status: number }).status = 500;
    throw err;
  }
  // upsert of a revoked row reopens it; if they were already active, don't demote them
  if ((data as TeamMember).status === "active") {
    return { member: data as TeamMember, token: "", inviteUrl: "" };
  }
  const base = (process.env.PUBLIC_URL || "https://ghostchat.pro").replace(/\/$/, "");
  return { member: data as TeamMember, token, inviteUrl: `${base}/login?invite=${token}` };
}

export async function revokeMember(workspaceId: string, memberRowId: string): Promise<void> {
  const { error } = await getDb()
    .from("ghostchat_team_members")
    .update({ status: "revoked", invite_token_hash: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", memberRowId);
  if (error) throw error;
}

export async function lookupInvite(token: string): Promise<{ email: string; workspaceName: string | null; role: MemberRole } | null> {
  if (!token || token.length < 16) return null;
  const { data } = await getDb()
    .from("ghostchat_team_members")
    .select("email, role, status, workspace_id")
    .eq("invite_token_hash", hashInviteToken(token))
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return null;
  const { data: owner } = await getDb().from("ghostchat_owners").select("name, email").eq("id", data.workspace_id).maybeSingle();
  return { email: data.email, role: data.role as MemberRole, workspaceName: owner?.name || owner?.email || null };
}

export async function acceptInvite(token: string, account: { id: string; email: string }): Promise<{ workspaceId: string; role: MemberRole }> {
  const invite = await getDb()
    .from("ghostchat_team_members")
    .select("id, workspace_id, email, role, status")
    .eq("invite_token_hash", hashInviteToken(token))
    .eq("status", "pending")
    .maybeSingle();
  if (!invite.data) {
    const err = new Error("That invite has expired or already been used.");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const row = invite.data;
  if (String(row.email).toLowerCase() !== account.email.trim().toLowerCase()) {
    const err = new Error(`Sign in with ${row.email} to accept this invite.`);
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("ghostchat_team_members")
    .update({ status: "active", member_id: account.id, accepted_at: now, invite_token_hash: null, updated_at: now })
    .eq("id", row.id);
  if (error) throw error;
  return { workspaceId: row.workspace_id, role: row.role as MemberRole };
}

export type WorkspaceRef = { id: string; name: string | null; email: string; plan: Plan; role: TeamRole; self: boolean };

export async function listWorkspaces(accountId: string, account: { email: string; name: string | null; plan: Plan }): Promise<WorkspaceRef[]> {
  const own: WorkspaceRef = { id: accountId, name: account.name, email: account.email, plan: account.plan, role: "owner", self: true };
  const { data, error } = await getDb()
    .from("ghostchat_team_members")
    .select("workspace_id, role, status")
    .eq("status", "active")
    .eq("member_id", accountId);
  if (error) throw error;
  const extras: WorkspaceRef[] = [];
  for (const row of data || []) {
    if (row.workspace_id === accountId) continue;
    const { data: owner } = await getDb()
      .from("ghostchat_owners")
      .select("id, name, email, plan")
      .eq("id", row.workspace_id)
      .maybeSingle();
    if (!owner) continue;
    extras.push({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      plan: (owner.plan as Plan) || "free",
      role: row.role as MemberRole,
      self: false,
    });
  }
  return [own, ...extras];
}

export async function resolveWorkspace(accountId: string, requested?: string | null): Promise<{ workspaceId: string; role: TeamRole }> {
  const want = (requested || "").trim();
  if (!want || want === accountId) return { workspaceId: accountId, role: "owner" };
  const { data, error } = await getDb()
    .from("ghostchat_team_members")
    .select("workspace_id, role, status")
    .eq("workspace_id", want)
    .eq("member_id", accountId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error("You don't have access to that workspace.");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return { workspaceId: data.workspace_id, role: data.role as MemberRole };
}
