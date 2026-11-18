/**
 * Widget launcher (floating bubble) options, with plan gating.
 * Classic icons/styles stay as they were. v3 jewel icons and styles are extras.
 * Free: classic 3 icons + 2 styles, plus the jewel orb with ghost mark or headset.
 * Pro/Business: full set, custom icon, size and position, animated shine styles.
 */
import type { Plan } from "../types.js";

export const CLASSIC_LAUNCHER_ICONS = ["ghost", "chat", "headset", "question", "sparkle"] as const;
export const V3_LAUNCHER_ICONS = ["jewel-headset", "ghost-headset", "chat-typing", "sparkle-chat", "ghost-mark", "message-check"] as const;
export const LAUNCHER_ICONS = [...CLASSIC_LAUNCHER_ICONS, ...V3_LAUNCHER_ICONS] as const;

export const CLASSIC_LAUNCHER_STYLES = ["solid", "outline", "gradient", "glass", "neon", "rounded-square", "pill"] as const;
export const V3_LAUNCHER_STYLES = ["jewel", "glass-shine", "gradient-shine", "outline-glow", "pill-support"] as const;
export const LAUNCHER_STYLES = [...CLASSIC_LAUNCHER_STYLES, ...V3_LAUNCHER_STYLES] as const;

export const LAUNCHER_SIZES = ["sm", "md", "lg"] as const;
export const LAUNCHER_SIDES = ["right", "left"] as const;

export const FREE_LAUNCHER_ICONS = ["ghost", "chat", "question", "ghost-mark", "jewel-headset"] as const;
export const FREE_LAUNCHER_STYLES = ["solid", "gradient", "jewel"] as const;

export const V3_ICON_ALIAS: Record<string, (typeof V3_LAUNCHER_ICONS)[number]> = {
  ghost: "ghost-mark",
  headset: "jewel-headset",
  chat: "chat-typing",
  sparkle: "sparkle-chat",
  question: "jewel-headset",
};

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

/** The live default for every site, new and existing, unless the owner picks something else. */
export function defaultLauncher(): Launcher {
  return { icon: "ghost", style: "gradient", size: "md", side: "right", offset: 22, label: "Chat", custom_icon: null };
}

export function isV3LauncherIcon(value: unknown): value is (typeof V3_LAUNCHER_ICONS)[number] {
  return (V3_LAUNCHER_ICONS as readonly string[]).includes(String(value || ""));
}

export function isV3LauncherStyle(value: unknown): value is (typeof V3_LAUNCHER_STYLES)[number] {
  return (V3_LAUNCHER_STYLES as readonly string[]).includes(String(value || ""));
}

export function usesV3Launcher(icon: string, style: string): boolean {
  return isV3LauncherStyle(style) || isV3LauncherIcon(icon);
}

export function mapToV3Icon(icon: string): (typeof V3_LAUNCHER_ICONS)[number] {
  if (isV3LauncherIcon(icon)) return icon;
  return V3_ICON_ALIAS[icon] || "ghost-mark";
}

/** Filename under /launcher/v3/ for the selected icon + style pair. */
export function v3LauncherFile(icon: string, style: string): string {
  const i = mapToV3Icon(icon);
  const s = isV3LauncherStyle(style) ? style : "jewel";
  return `${i}--${s}.svg`;
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
