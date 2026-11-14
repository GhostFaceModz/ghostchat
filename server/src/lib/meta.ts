/**
 * WhatsApp + Instagram DMs (Meta Cloud API) — SCAFFOLDING, OFF by default.
 * Needs a Meta Business account, a WhatsApp Business number / Instagram professional account, and a Meta app.
 * Nothing runs until META_CHANNELS_ENABLED=true and the site is on the Business plan with the channel switched on.
 */
import crypto from "node:crypto";
import type { Site } from "../types.js";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
export const metaEnabled = () => String(process.env.META_CHANNELS_ENABLED || "").toLowerCase() === "true";

export type MetaChannel = "whatsapp" | "instagram";
export type MetaMessage = { channel: MetaChannel; accountId: string; from: string; text: string; id: string };
export type SiteChannels = { whatsapp?: { enabled?: boolean; phone_number_id?: string }; instagram?: { enabled?: boolean; account_id?: string } };

export function verifyMetaSignature(rawBody: string | Buffer, header: string | undefined, secret = process.env.META_APP_SECRET || ""): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Webhook verification handshake (GET). Returns the challenge to echo, or null to reject. */
export function verifyChallenge(q: Record<string, unknown>, token = process.env.META_VERIFY_TOKEN || ""): string | null {
  if (!token) return null;
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === token && typeof q["hub.challenge"] === "string") return q["hub.challenge"];
  return null;
}

/** Pull plain text messages out of a WhatsApp or Instagram webhook payload. */
export function extractMetaMessages(body: unknown): MetaMessage[] {
  const out: MetaMessage[] = [];
  const b = (body || {}) as { object?: string; entry?: Array<Record<string, unknown>> };
  for (const entry of b.entry || []) {
    if (b.object === "whatsapp_business_account") {
      for (const change of (entry.changes as Array<{ value?: Record<string, unknown> }>) || []) {
        const v = change.value || {};
        const phoneId = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id || "");
        for (const m of (v.messages as Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>) || []) {
          if (m.type === "text" && m.text?.body && m.from) out.push({ channel: "whatsapp", accountId: phoneId, from: m.from, text: m.text.body.slice(0, 2000), id: m.id || "" });
        }
      }
    } else if (b.object === "instagram") {
      for (const ev of (entry.messaging as Array<{ sender?: { id?: string }; recipient?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean } }>) || []) {
        if (ev.message?.text && !ev.message.is_echo && ev.sender?.id) out.push({ channel: "instagram", accountId: String(ev.recipient?.id || entry.id || ""), from: ev.sender.id, text: ev.message.text.slice(0, 2000), id: ev.message.mid || "" });
      }
    }
  }
  return out;
}

/** Business tier gate + the owner's per-channel switch. */
export function channelActive(site: Pick<Site, "plan" | "channels">, channel: MetaChannel): boolean {
  if (!metaEnabled() || site.plan !== "business") return false;
  const ch = ((site.channels || {}) as SiteChannels)[channel];
  return Boolean(ch?.enabled);
}

export function normalizeChannels(input: unknown, plan: string): SiteChannels {
  const raw = (input && typeof input === "object" ? input : {}) as SiteChannels;
  const id = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "").slice(0, 30);
  const business = plan === "business";
  return {
    whatsapp: { enabled: business && raw.whatsapp?.enabled === true, phone_number_id: id(raw.whatsapp?.phone_number_id) },
    instagram: { enabled: business && raw.instagram?.enabled === true, account_id: id(raw.instagram?.account_id) },
  };
}

export async function sendMetaReply(msg: MetaMessage, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN || "";
  if (!token) throw new Error("META_ACCESS_TOKEN is not set.");
  const body = msg.channel === "whatsapp"
    ? { messaging_product: "whatsapp", to: msg.from, type: "text", text: { body: text.slice(0, 4000) } }
    : { recipient: { id: msg.from }, message: { text: text.slice(0, 1000) } };
  const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${msg.accountId}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meta send failed (${res.status})`);
}
