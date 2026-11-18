import { Router } from "express";
import { denyIfNotOwner, type AuthedRequest, workspaceId } from "../lib/auth.js";
import { acceptInvite, countSeatsUsed, inviteMember, listMembers, lookupInvite, revokeMember, seatsFor } from "../lib/team.js";
import { getOwnerPlan } from "../lib/usage.js";
import { mailerConfigured, sendMail } from "../lib/mailer.js";

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
    res.json({ member, inviteUrl: token ? inviteUrl : undefined, emailed });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 500).json({ error: e.message || "Could not invite that teammate." });
  }
});

teamRouter.delete("/:id", async (req, res) => {
  if (denyIfNotOwner(req, res)) return;
  try {
    await revokeMember(workspaceId(req), req.params.id);
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
