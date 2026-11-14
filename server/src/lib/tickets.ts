/** Support tickets created by the support assistant (ghostchat_tickets). */
import { getDb } from "./supabase.js";
import { transcript, addLog } from "./live.js";
import { notifyOwner } from "./relay.js";
import { redactPii } from "./pii.js";
import type { Site } from "../types.js";

export type TicketStatus = "open" | "pending" | "solved";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export const TICKET_STATUSES: TicketStatus[] = ["open", "pending", "solved"];
export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export type Ticket = {
  id: string; site_id: string; session_id: string | null; number: number | null; subject: string; name: string | null; email: string | null;
  details: Record<string, unknown>; status: TicketStatus; priority: TicketPriority; transcript: string | null;
  messages: Array<{ from: "visitor" | "agent" | "system"; text: string; at: string; name?: string | null }>; rating: number | null;
  created_at: string; updated_at: string; solved_at: string | null;
};

const rank: Record<TicketPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export function higherPriority(a: TicketPriority, b: TicketPriority): TicketPriority { return rank[a] >= rank[b] ? a : b; }

export function ticketSubject(text: string): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "Support request";
  return t.length > 80 ? t.slice(0, 79).replace(/\s+\S*$/, "") + "…" : t;
}

export async function transcriptText(siteId: string, sessionId: string): Promise<string | null> {
  const rows = await transcript(siteId, sessionId, 60).catch(() => []);
  if (!rows.length) return null;
  return rows.map((r) => `${r.role === "user" ? "Visitor" : r.role === "agent" ? r.agent_name || "Team" : r.role === "system" ? "System" : "GhostChat"}: ${r.message}`).join("\n");
}

/** One open ticket per conversation: a second request updates it instead of creating a duplicate. */
export async function openTicket(site: Site, sessionId: string, input: { name?: string | null; email?: string | null; subject?: string; details?: Record<string, unknown>; priority?: TicketPriority; source: string }): Promise<Ticket> {
  const db = getDb();
  const now = new Date().toISOString();
  const { data: existing } = await db.from("ghostchat_tickets").select("*").eq("site_id", site.id).eq("session_id", sessionId).in("status", ["open", "pending"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const text = await transcriptText(site.id, sessionId);
  if (existing) {
    const t = existing as Ticket;
    const patch = {
      name: input.name || t.name, email: input.email || t.email, transcript: text ?? t.transcript, updated_at: now, status: "open" as TicketStatus,
      details: { ...(t.details || {}), ...(input.details || {}) }, priority: higherPriority(t.priority, input.priority || "normal"),
    };
    const { data, error } = await db.from("ghostchat_tickets").update(patch).eq("id", t.id).select("*").single();
    if (error) throw error;
    return data as Ticket;
  }
  const { count } = await db.from("ghostchat_tickets").select("id", { count: "exact", head: true }).eq("site_id", site.id);
  const row = {
    site_id: site.id, session_id: sessionId, number: (count ?? 0) + 1, subject: ticketSubject(input.subject || ""), name: input.name || null, email: input.email || null,
    details: { ...(input.details || {}), source: input.source }, priority: input.priority || "normal", transcript: text,
    messages: input.details?.message ? [{ from: "visitor", text: redactPii(String(input.details.message)), at: now }] : [],
  };
  const { data, error } = await db.from("ghostchat_tickets").insert(row).select("*").single();
  if (error) throw error;
  const ticket = data as Ticket;
  const who = [ticket.name, ticket.email].filter(Boolean).join(" · ");
  notifyOwner(site.owner_id, `🎫 New ${ticket.priority === "urgent" ? "URGENT " : ""}support ticket #${ticket.number} on ${site.name}${who ? ` from ${who}` : ""}\n${ticket.subject}\n\nOpen the GhostChat dashboard → Tickets to reply.`).catch(() => {});
  return ticket;
}

/** Owner reply: stored on the ticket and added to the visitor's conversation so it shows in the chat. */
export async function replyToTicket(site: Site, ticket: Ticket, text: string, agentName: string, status?: TicketStatus): Promise<Ticket> {
  const now = new Date().toISOString();
  const messages = [...(ticket.messages || []), { from: "agent" as const, text: text.slice(0, 4000), at: now, name: agentName }];
  const next = status || (ticket.status === "open" ? "pending" : ticket.status);
  const { data, error } = await getDb().from("ghostchat_tickets").update({ messages, status: next, updated_at: now, solved_at: next === "solved" ? now : null }).eq("id", ticket.id).select("*").single();
  if (error) throw error;
  if (ticket.session_id) await addLog({ site_id: site.id, session_id: ticket.session_id, role: "agent", message: text.slice(0, 4000), agent_name: agentName }).catch(() => null);
  return data as Ticket;
}
