import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { isValidEmail } from "../lib/auth.js";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import { incrementLeads, assertCanCaptureLead } from "../lib/usage.js";
import { redactPii } from "../lib/pii.js";
import { chatForm, SUPPORT_FORM_FIELDS, submissionNotes, validateSubmission } from "../lib/forms.js";
import { openTicket } from "../lib/tickets.js";
import { ticketPriority } from "../lib/modes.js";
import { notifyOwner } from "../lib/relay.js";
import type { Site } from "../types.js";
import { loadSiteByPublicKey } from "../lib/staging.js";

export const leadsRouter = Router();

leadsRouter.post("/", async (req, res) => {
  const siteKey = String(req.body?.siteKey || req.body?.site_key || "");
  const kind = req.body?.kind === "support" ? "support" : req.body?.kind === "form" ? "form" : "email";
  const email = String(req.body?.email || "").trim().toLowerCase();
  let name = String(req.body?.name || "").trim().slice(0, 200) || null;
  let notes = String(req.body?.notes || "").trim().slice(0, 2000) || null;
  let formValues: Record<string, string> = {};
  const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim() || null;

  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

  const ip = clientIp(req);
  const rl = await rateLimitAsync(`lead:${siteKey}:${ip}`, 8, 30 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many submissions. Try again shortly." });

  let site: Site | null = null;
  try { site = await loadSiteByPublicKey(siteKey); } catch { site = null; }
  if (!site) return res.status(404).json({ error: "Unknown site key." });
  const typed = site;
  if (kind !== "email") {
    // In-chat forms: validate against the owner's fields (or the support ticket fields).
    const fields = kind === "support" ? SUPPORT_FORM_FIELDS : chatForm(typed).fields;
    const checked = validateSubmission(fields, { ...req.body, email });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    formValues = checked.values;
    name = formValues.name || name;
    notes = submissionNotes(formValues) || notes;
  }
  try {
    await assertCanCaptureLead(typed);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    return res.status(status).json({ error: (err as Error).message });
  }

  let transcript: string | null = null;
  if (sessionId) {
    const { data: logs } = await getDb()
      .from("ghostchat_logs")
      .select("role, message, created_at")
      .eq("site_id", typed.id)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(40);
    if (logs?.length) {
      transcript = logs
        .map((row: { role: string; message: string }) => `${row.role === "user" ? "Visitor" : "GhostChat"}: ${row.message}`)
        .join("\n");
    }
  }

  const { data, error } = await getDb()
    .from("ghostchat_leads")
    .insert({
      site_id: typed.id,
      session_id: sessionId,
      email,
      name,
      notes: notes ? redactPii(notes) : null,
      transcript,
    })
    .select("id, created_at")
    .single();
  if (error) return res.status(500).json({ error: "Could not save that email." });
  await incrementLeads(typed.id);
  let ticket: { id: string; number: number | null } | null = null;
  if (kind === "support" && sessionId) {
    const t = await openTicket(typed, sessionId, {
      name, email, subject: formValues.message || "Support request", priority: ticketPriority(formValues.message || ""),
      details: { order: formValues.order || null, message: formValues.message || null }, source: "form",
    }).catch((e) => { console.error("ticket:", (e as Error).message); return null; });
    ticket = t ? { id: t.id, number: t.number } : null;
  } else if (kind === "form") {
    notifyOwner(typed.owner_id, `📝 New ${typed.name} enquiry from ${[name, email].filter(Boolean).join(" · ")}\n${notes || ""}`.trim()).catch(() => {});
  }
  res.status(201).json({ lead: data, ticket });
});
