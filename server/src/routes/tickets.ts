import { Router, type Request } from "express";
import { getDb } from "../lib/supabase.js";
import type { AuthedRequest } from "../lib/auth.js";
import { replyToTicket, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket } from "../lib/tickets.js";
import { agentNameFor, rememberOwnerAgentName } from "../lib/handoff.js";
import { resolveAgentName } from "../lib/live.js";
import type { Site } from "../types.js";

/** Owner Tickets view: list, read, reply, change status/priority. Mounted under /api/sites (auth required). */
export const ticketsRouter = Router();

async function ownedSite(req: Request): Promise<Site | null> {
  const owner = (req as unknown as AuthedRequest).owner;
  const { data } = await getDb().from("ghostchat_sites").select("*").eq("id", req.params.id).eq("owner_id", owner.id).maybeSingle();
  return (data as Site) ?? null;
}

ticketsRouter.get("/:id/tickets", async (req, res) => {
  const site = await ownedSite(req);
  if (!site) return res.status(404).json({ error: "Site not found." });
  let q = getDb().from("ghostchat_tickets").select("id, number, subject, name, email, status, priority, rating, created_at, updated_at").eq("site_id", site.id);
  const status = String(req.query.status || "");
  if (TICKET_STATUSES.includes(status as Ticket["status"])) q = q.eq("status", status);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: "Could not load tickets." });
  res.json({ tickets: data ?? [] });
});

ticketsRouter.get("/:id/tickets/:tid", async (req, res) => {
  const site = await ownedSite(req);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { data } = await getDb().from("ghostchat_tickets").select("*").eq("id", req.params.tid).eq("site_id", site.id).maybeSingle();
  if (!data) return res.status(404).json({ error: "Ticket not found." });
  res.json({ ticket: data });
});

ticketsRouter.post("/:id/tickets/:tid/reply", async (req, res) => {
  const site = await ownedSite(req);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Write a reply first." });
  const { data } = await getDb().from("ghostchat_tickets").select("*").eq("id", req.params.tid).eq("site_id", site.id).maybeSingle();
  if (!data) return res.status(404).json({ error: "Ticket not found." });
  const status = TICKET_STATUSES.includes(req.body?.status) ? req.body.status : undefined;
  const owner = (req as unknown as AuthedRequest).owner;
  const agent = resolveAgentName({
    provided: typeof req.body?.agentName === "string" ? req.body.agentName : null,
    remembered: owner.agent_display_name,
    discordId: owner.discord_id,
    discordName: owner.name,
  });
  if (agent.needsName) return res.status(400).json({ error: "Enter the name visitors will see in the chat.", needName: true });
  if (agent.source === "provided" && agent.name) await rememberOwnerAgentName(owner.id, agent.name);
  const ticket = await replyToTicket(site, data as Ticket, text, agent.name || await agentNameFor(site), status);
  res.json({ ticket, agentName: agent.name });
});

ticketsRouter.patch("/:id/tickets/:tid", async (req, res) => {
  const site = await ownedSite(req);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (TICKET_STATUSES.includes(req.body?.status)) { patch.status = req.body.status; patch.solved_at = req.body.status === "solved" ? new Date().toISOString() : null; }
  if (TICKET_PRIORITIES.includes(req.body?.priority)) patch.priority = req.body.priority;
  const { data, error } = await getDb().from("ghostchat_tickets").update(patch).eq("id", req.params.tid).eq("site_id", site.id).select("*").maybeSingle();
  if (error || !data) return res.status(404).json({ error: "Ticket not found." });
  res.json({ ticket: data });
});
