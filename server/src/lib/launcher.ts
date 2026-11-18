/**
 * Widget launcher (floating bubble) options, with plan gating.
 * Free: 3 icons and 2 styles. Pro/Business: full set, custom icon, size and position.
 */
import type { Plan } from "../types.js";

export const LAUNCHER_ICONS = ["ghost", "chat", "headset", "question", "sparkle"] as const;
export const LAUNCHER_STYLES = ["solid", "outline", "gradient", "glass", "neon", "rounded-square", "pill"] as const;
export const LAUNCHER_SIZES = ["sm", "md", "lg"] as const;
export const LAUNCHER_SIDES = ["right", "left"] as const;

export const FREE_LAUNCHER_ICONS = ["ghost", "chat", "question"] as const;
export const FREE_LAUNCHER_STYLES = ["solid", "gradient"] as const;

export type LauncherIcon = (typeof LAUNCHER_ICONS)[number] | "custom";
export type LauncherStyle = (typeof LAUNCHER_STYLES)[number];
export type LauncherSize = (typeof LAUNCHER_SIZES)[number];
export type LauncherSide = (typeof LAUNCHER_SIDES)[number];

export type Launcher = {
  icon: LauncherIcon;
  style: LauncherStyle;
  size: LauncherSize;
  side: LauncherSide;
  offset: number;
  label: string;
  custom_icon: string | null;
};

const MAX_CUSTOM = 80_000;
const CUSTOM_RE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;

export function defaultLauncher(): Launcher {
  return { icon: "ghost", style: "gradient", size: "md", side: "right", offset: 22, label: "Chat", custom_icon: null };
}

export function launcherLimits(plan: Plan | string) {
  const paid = plan === "pro" || plan === "business";
  return {
    icons: paid ? ([...LAUNCHER_ICONS, "custom"] as LauncherIcon[]) : ([...FREE_LAUNCHER_ICONS] as LauncherIcon[]),
    styles: paid ? ([...LAUNCHER_STYLES] as LauncherStyle[]) : ([...FREE_LAUNCHER_STYLES] as LauncherStyle[]),
    custom: paid,
    size: paid,
    side: paid,
    offset: paid,
    label: paid,
  };
}

export function sanitizeCustomIcon(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.replace(/\s+/g, "").trim();
  if (!raw || raw.length > MAX_CUSTOM) return null;
  if (!CUSTOM_RE.test(raw)) return null;
  return raw;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(value || "").trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function sanitizeLauncher(raw: unknown, plan: Plan | string): Launcher {
  const limits = launcherLimits(plan);
  const d = defaultLauncher();
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let icon = pick<LauncherIcon>(src.icon, limits.icons, d.icon);
  const custom = limits.custom ? sanitizeCustomIcon(src.custom_icon) : null;
  if (icon === "custom" && !custom) icon = "ghost";
  const style = pick<LauncherStyle>(src.style, limits.styles, limits.styles.includes(d.style) ? d.style : limits.styles[0]);
  const size = limits.size ? pick<LauncherSize>(src.size, LAUNCHER_SIZES, d.size) : d.size;
  const side = limits.side ? pick<LauncherSide>(src.side, LAUNCHER_SIDES, d.side) : d.side;
  const offsetRaw = Number(src.offset);
  const offset = limits.offset && Number.isFinite(offsetRaw) ? Math.min(64, Math.max(8, Math.round(offsetRaw))) : d.offset;
  const label = limits.label && typeof src.label === "string" ? src.label.replace(/\s+/g, " ").trim().slice(0, 18) : d.label;
  return { icon, style, size, side, offset, label: label || d.label, custom_icon: icon === "custom" ? custom : (custom && limits.custom ? custom : null) };
}

export const LAUNCHER_SIZE_PX: Record<LauncherSize, number> = { sm: 44, md: 52, lg: 64 };
