/** Booking / forms in chat: owner-defined fields collected in the widget, saved as leads (and tickets in support mode). */
import type { ConversionCard, Site } from "../types.js";

export type FormFieldKey = "name" | "email" | "phone" | "date" | "message" | "order";
export type FormField = { key: FormFieldKey; label: string; required: boolean };
export type ChatForm = { enabled: boolean; title: string; subtitle: string; cta: string; fields: FormField[]; triggers: string[] };

export const FIELD_KEYS: FormFieldKey[] = ["name", "email", "phone", "date", "message", "order"];
const LABELS: Record<FormFieldKey, string> = { name: "Your name", email: "Email", phone: "Phone", date: "Preferred date", message: "Message", order: "Order or account number" };

export const DEFAULT_FORM: ChatForm = {
  enabled: false,
  title: "Book or request a callback",
  subtitle: "Leave your details and we'll get back to you.",
  cta: "Send",
  fields: [
    { key: "name", label: LABELS.name, required: true },
    { key: "email", label: LABELS.email, required: true },
    { key: "date", label: LABELS.date, required: false },
    { key: "message", label: LABELS.message, required: false },
  ],
  triggers: ["book", "booking", "appointment", "callback", "quote", "contact"],
};

export const SUPPORT_FORM_FIELDS: FormField[] = [
  { key: "name", label: LABELS.name, required: true },
  { key: "email", label: LABELS.email, required: true },
  { key: "order", label: LABELS.order, required: false },
  { key: "message", label: "What's going wrong?", required: true },
];

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function normalizeChatForm(input: unknown): ChatForm {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fields: FormField[] = [];
  for (const f of Array.isArray(raw.fields) ? raw.fields : DEFAULT_FORM.fields) {
    const r = (typeof f === "string" ? { key: f } : f) as Record<string, unknown>;
    const key = String(r?.key || "") as FormFieldKey;
    if (!FIELD_KEYS.includes(key) || fields.some((x) => x.key === key)) continue;
    fields.push({ key, label: clip(r.label, 60) || LABELS[key], required: key === "email" ? true : Boolean(r.required) });
  }
  if (!fields.some((f) => f.key === "email")) fields.unshift({ key: "email", label: LABELS.email, required: true });
  return {
    enabled: raw.enabled === true,
    title: clip(raw.title, 120) || DEFAULT_FORM.title,
    subtitle: clip(raw.subtitle, 240) || DEFAULT_FORM.subtitle,
    cta: clip(raw.cta, 40) || DEFAULT_FORM.cta,
    fields: fields.slice(0, 6),
    triggers: (Array.isArray(raw.triggers) ? raw.triggers : typeof raw.triggers === "string" ? raw.triggers.split(",") : DEFAULT_FORM.triggers)
      .map((t) => clip(t, 40).toLowerCase()).filter(Boolean).slice(0, 20),
  };
}

export function chatForm(site: Pick<Site, "chat_form">): ChatForm {
  return normalizeChatForm(site.chat_form && Object.keys(site.chat_form).length ? site.chat_form : DEFAULT_FORM);
}

export function formMatches(form: ChatForm, text: string): boolean {
  if (!form.enabled) return false;
  const lower = text.toLowerCase();
  return form.triggers.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower));
}

export function formCard(form: ChatForm): ConversionCard {
  return { id: "chat-form", type: "form", kind: "lead", title: form.title, subtitle: form.subtitle, cta: form.cta, fields: form.fields };
}

export function supportCard(outOfHours: string | null): ConversionCard {
  return {
    id: "support-ticket", type: "form", kind: "support",
    title: outOfHours ? "Leave your details for the team" : "Pass this to the support team",
    subtitle: outOfHours || "We'll open a ticket and follow up by email.",
    cta: "Create ticket", fields: SUPPORT_FORM_FIELDS,
  };
}

/** Validate a submitted form. Returns cleaned values or an error message. */
export function validateSubmission(fields: FormField[], values: Record<string, unknown>): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = clip(values[f.key], f.key === "message" ? 2000 : 200);
    if (f.required && !v) return { ok: false, error: `Please fill in ${f.label.toLowerCase()}.` };
    if (v && f.key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: "Enter a valid email address." };
    if (v && f.key === "phone" && !/^[+()\d\s.-]{6,25}$/.test(v)) return { ok: false, error: "Enter a valid phone number." };
    if (v && f.key === "date" && Number.isNaN(Date.parse(v)) && v.length > 60) return { ok: false, error: "Enter a valid date." };
    if (v) out[f.key] = v;
  }
  return { ok: true, values: out };
}

export function submissionNotes(values: Record<string, string>): string {
  return (["date", "phone", "order", "message"] as FormFieldKey[]).filter((k) => values[k]).map((k) => `${LABELS[k].replace("Your ", "")}: ${values[k]}`).join("\n");
}
