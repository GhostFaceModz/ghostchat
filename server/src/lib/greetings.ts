/** Proactive greetings: per-URL-pattern message after X seconds, shown once per session (widget enforces once). */
export type Greeting = { pattern: string; message: string; delay_s: number };

export function normalizeGreetings(input: unknown): Greeting[] {
  if (!Array.isArray(input)) return [];
  const out: Greeting[] = [];
  for (const raw of input) {
    const r = (raw || {}) as Record<string, unknown>;
    const message = String(r.message ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!message) continue;
    let pattern = String(r.pattern ?? "").trim().slice(0, 120) || "*";
    if (!pattern.startsWith("/") && pattern !== "*") pattern = "/" + pattern;
    const delay = Math.round(Number(r.delay_s));
    out.push({ pattern, message, delay_s: Number.isFinite(delay) ? Math.min(300, Math.max(3, delay)) : 15 });
    if (out.length >= 10) break;
  }
  return out;
}

/** Same matching as the widget: "*" = any page, trailing "*" = prefix, otherwise exact path (trailing slash ignored). */
export function greetingFor(greetings: Greeting[], path: string): Greeting | null {
  const p = (path || "/").replace(/\/+$/, "") || "/";
  for (const g of greetings) {
    if (g.pattern === "*") return g;
    const pat = g.pattern.replace(/\/+$/, "") || "/";
    if (pat.endsWith("*") ? p.startsWith(pat.slice(0, -1)) : p === pat) return g;
  }
  return null;
}
