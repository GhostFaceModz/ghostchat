import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

let cached: { file: string; version: string } | null = null;

export function widgetFile(repoRoot: string): string {
  const min = path.join(repoRoot, "widget", "widget.min.js");
  const src = path.join(repoRoot, "widget", "widget.js");
  return fs.existsSync(min) ? min : src;
}

export function widgetVersion(repoRoot?: string): string {
  if (cached) return cached.version;
  const root = repoRoot || process.cwd();
  const versionFile = path.join(root, "widget", "version.txt");
  if (fs.existsSync(versionFile)) {
    const v = fs.readFileSync(versionFile, "utf8").trim();
    if (v) {
      cached = { file: versionFile, version: v };
      return v;
    }
  }
  try {
    const file = widgetFile(root);
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
    cached = { file, version: hash };
    return hash;
  } catch {
    return "dev";
  }
}

/** Long cache when the URL is versioned (?v=hash). Unversioned embeds revalidate within a minute so a fixed widget.js is not stuck for a day. */
export function widgetCacheControl(versionQuery: string): string {
  if (versionQuery && versionQuery !== "dev") return "public, max-age=31536000, immutable";
  return "public, max-age=60, must-revalidate";
}

export function widgetSrc(origin = "https://ghostchat.pro", root?: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/widget.js?v=${widgetVersion(root)}`;
}

export function _resetWidgetAssetCache(): void {
  cached = null;
}
