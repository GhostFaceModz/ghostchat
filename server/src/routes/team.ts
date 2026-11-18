import { Router } from "express";
import { denyIfNotOwner, type AuthedRequest, workspaceId } from "../lib/auth.js";
import { acceptInvite, countSeatsUsed, inviteMember, listMembers, lookupInvite, revokeMember, seatsFor } from "../lib/team.js";
import { getOwnerPlan } from "../lib/usage.js";
import { mailerConfigured, sendMail } from "../lib/mailer.js";
import { auditFromReq, listAudit } from "../lib/audit.js";
import { normalizeCreditCap, setMemberCreditCap } from "../lib/agentCredits.js";
import { loadAgentReviews } from "../lib/agentReviews.js";

export const teamRouter = Router();

teamRouter.get("/", async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  const ws = workspaceId(req);
  // Team management is always for the billing workspace being viewed; listing is ok for members.
  const plan = await getOwnerPlan(ws);
  const members = await listMembers(ws);
  const used = await countSeatsUsed(ws);
  res.json({
    workspaceId: ws,
    plan,
    seats: { used, cap: seatsFor(plan) },
    members,
    role: (req as AuthedRequest).role,
    self: owner.id === ws,
  });
});


teamRouter.get("/reviews", async (req, res) => {
  const ws = workspaceId(req);
  try {
    const board = await loadAgentReviews(ws);
    res.json(board);
  } catch (err) {
    const e = err as Error;
    console.error("agent reviews:", e.message);
    res.status(500).json({ error: "Could not load agent reviews." });
  }
});

teamRouter.get("/audit", async (req, res) => {
  const ws = workspaceId(req);
  try {
    const events = await listAudit(ws, Number(req.query.limit) || 50);
    res.json({ events });
  } catch {
    res.status(500).json({ error: "Could not load the audit log." });
  }
});

teamRouter.post("/invites", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  const owner = (req as AuthedRequest).owner;
  try {
    const { member, token, inviteUrl } = await inviteMember(workspaceId(req), owner.id, String(req.body?.email || ""), String(req.body?.role || "agent"));
    let emailed = false;
    if (token && mailerConfigured()) {
      const letter = await sendMail({
        to: member.email,
        subject: "You're invited to a GhostChat workspace",
        text: `You've been invited to help with a GhostChat inbox as a ${member.role}.\n\nAccept the invite:\n${inviteUrl}\n\nSign in with this same email address.`,
      });
      emailed = letter.ok;
    }
    auditFromReq(req, "team.invite", { targetType: "member", targetId: member.id, meta: { email: member.email, role: member.role, emailed } }).catch(() => {});
    res.json({ member, inviteUrl: token ? inviteUrl : undefined, emailed });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 500).json({ error: e.message || "Could not invite that teammate." });
  }
});

teamRouter.patch("/:id", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  try {
    const member = await setMemberCreditCap(workspaceId(req), req.params.id, normalizeCreditCap(req.body?.credit_cap));
    auditFromReq(req, "team.credit_cap", { targetType: "member", targetId: member.id, meta: { email: member.email, credit_cap: member.credit_cap } }).catch(() => {});
    res.json({ member });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 500).json({ error: e.message || "Could not update that cap." });
  }
});

teamRouter.delete("/:id", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  try {
    await revokeMember(workspaceId(req), req.params.id);
    auditFromReq(req, "team.remove", { targetType: "member", targetId: req.params.id }).catch(() => {});
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not remove that teammate." });
  }
});

export const teamPublicRouter = Router();

teamRouter.post("/invites/:token/accept", async (req, res) => {
  const session = (req as unknown as AuthedRequest).owner;
  try {
    const accepted = await acceptInvite(req.params.token, session);
    auditFromReq(req, "team.accept", { targetType: "member", targetId: session.id }).catch(() => {});
    res.json({ ok: true, ...accepted });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 500).json({ error: e.message || "Could not accept that invite." });
  }
});

teamPublicRouter.get("/invites/:token", async (req, res) => {
  const invite = await lookupInvite(req.params.token).catch(() => null);
  if (!invite) return res.status(404).json({ error: "That invite has expired or already been used." });
  res.json({ invite });
});
