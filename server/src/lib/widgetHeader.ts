/** Widget panel header title/subtitle, gated by plan. */
import type { Plan } from "../types.js";

export const HEADER_TITLE_PRESETS = [
  "GhostChat",
  "GhostChat Support",
  "Support",
  "Help Center",
  "Customer Care",
  "Live Help",
  "Sales Assistant",
] as const;

export const HEADER_SUBTITLE_PRESETS = [
  "AI assistant · Online",
  "Support · Online",
  "We reply instantly",
] as const;

export const DEFAULT_HEADER_TITLE = "GhostChat";
export const DEFAULT_HEADER_SUBTITLE = "AI assistant · Online";

export type WidgetHeader = { title: string; subtitle: string };

export function defaultHeader(): WidgetHeader {
  return { title: DEFAULT_HEADER_TITLE, subtitle: DEFAULT_HEADER_SUBTITLE };
}

export function cleanHeaderLine(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function pickPreset<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(value || "").trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function sanitizeHeader(raw: unknown, plan: Plan | string, siteName?: string | null): WidgetHeader {
  const d = defaultHeader();
  if (plan !== "pro" && plan !== "business") return d;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const configured = Boolean(src && (typeof src.title === "string" || typeof src.subtitle === "string"));
  if (!configured) {
    return { title: cleanHeaderLine(siteName, 40) || d.title, subtitle: d.subtitle };
  }
  if (plan === "pro") {
    return {
      title: pickPreset(src.title, HEADER_TITLE_PRESETS, d.title),
      subtitle: pickPreset(src.subtitle, HEADER_SUBTITLE_PRESETS, d.subtitle),
    };
  }
  return {
    title: cleanHeaderLine(src.title, 40) || d.title,
    subtitle: cleanHeaderLine(src.subtitle, 60) || d.subtitle,
  };
}
