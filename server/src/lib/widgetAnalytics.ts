/** Owner-pasted Plausible domain or GA4 measurement ID, shown to the widget so it can fire events. */
export const DEFAULT_ANALYTICS_EVENTS = ["open", "message_sent", "lead_captured", "handoff"] as const;

export function sanitizePlausibleDomain(raw: string): string | null {
  let v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (v.startsWith("www.")) v = v.slice(4);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v)) return null;
  if (v.length > 253) return null;
  return v;
}

export function sanitizeGa4Id(raw: string): string | null {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return null;
  if (!/^G-[A-Z0-9]{4,14}$/.test(v)) return null;
  return v;
}
