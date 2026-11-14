import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

/** Link-preview (Open Graph) cards drawn as SVG and rasterised with resvg, so text is always crisp. */
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = [path.resolve(here, "../../assets"), path.resolve(here, "../../server/assets"), path.resolve(process.cwd(), "server/assets")];
const asset = (rel: string) => {
  for (const base of assets) { try { return readFileSync(path.join(base, rel)); } catch { /* next */ } }
  throw new Error(`missing asset ${rel}`);
};
const fontFiles = () => ["fonts/Unbounded-Bold.ttf", "fonts/Inter-SemiBold.ttf", "fonts/Inter-Medium.ttf"].map((f) => {
  for (const base of assets) { const p = path.join(base, f); try { readFileSync(p, { flag: "r" }); return p; } catch { /* next */ } }
  return f;
});

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString("base64")}`;

/** Rough text width for wrapping (Unbounded is wide: ~0.74em per char; Inter ~0.56em). */
export function wrap(text: string, maxWidth: number, fontSize: number, em = 0.74, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length * fontSize * em > maxWidth && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while ((last.length + 1) * fontSize * em > maxWidth && last.includes(" ")) last = last.replace(/\s+\S+$/, "");
    kept[maxLines - 1] = `${last.replace(/[\s,;:.\-–—]+$/, "")}…`;
    return kept;
  }
  return lines;
}

export function hexColor(input: string | null | undefined, fallback = "#8b5cf6"): string {
  const v = String(input || "").trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? `#${v.slice(1).split("").map((c) => c + c).join("")}` : fallback;
}
const mix = (hex: string, to: string, t: number) => {
  const a = hex.match(/\w\w/g)!.map((x) => parseInt(x, 16)), b = to.match(/\w\w/g)!.map((x) => parseInt(x, 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

export function render(svg: string, width: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Inter" },
  });
  return r.render().asPng();
}

const SUBLINE = ["Free to start", "Live human handoff", "Your brand"];

/** The GhostChat brand card: 1200x630 (wide) or 1200x1200 (square, WhatsApp). */
export function brandCardSvg(kind: "wide" | "square"): string {
  const W = 1200, H = kind === "wide" ? 630 : 1200;
  const bg = dataUri(asset(`og/bg-${kind}.jpg`), "image/jpeg");
  const head = kind === "wide"
    ? { x: 72, y: 214, size: 58, lines: ["GhostChat —", "Premium AI chat", "for your website"], anchor: "start" }
    : { x: 600, y: 760, size: 66, lines: ["GhostChat —", "Premium AI chat", "for your website"], anchor: "middle" };
  const lh = Math.round(head.size * 1.18);
  const tspans = head.lines.map((l, i) => {
    const t = i === 0 ? `<tspan fill="url(#brand)">GhostChat</tspan><tspan fill="#f5f3ff"> —</tspan>` : esc(l);
    return `<tspan x="${head.x}" dy="${i === 0 ? 0 : lh}">${t}</tspan>`;
  }).join("");
  const subY = head.y + lh * (head.lines.length - 1) + (kind === "wide" ? 74 : 92);
  const chips = (() => {
    const size = kind === "wide" ? 25 : 30, padX = 18, gap = 12, h = size + 24;
    const widths = SUBLINE.map((s) => Math.round(s.length * size * 0.56 + padX * 2));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (SUBLINE.length - 1);
    let x = kind === "wide" ? head.x : (W - total) / 2;
    return SUBLINE.map((s, i) => {
      const g = `<g transform="translate(${x} ${subY - size - 4})"><rect width="${widths[i]}" height="${h}" rx="${h / 2}" fill="rgba(139,92,246,.16)" stroke="rgba(196,181,253,.38)"/><text x="${widths[i] / 2}" y="${h / 2 + size * 0.36}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="${size}" fill="#e9e3ff">${esc(s)}</text></g>`;
      x += widths[i] + gap;
      return g;
    }).join("");
  })();
  const footY = kind === "wide" ? H - 54 : H - 72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c4b5fd"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#67e8f9"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="${kind === "wide" ? "1" : "0"}" y2="${kind === "wide" ? "0" : "1"}">
      ${kind === "wide" ? `<stop offset="0" stop-color="#07040c" stop-opacity=".82"/><stop offset=".5" stop-color="#07040c" stop-opacity=".35"/><stop offset=".7" stop-color="#07040c" stop-opacity="0"/>` : `<stop offset=".45" stop-color="#07040c" stop-opacity="0"/><stop offset=".62" stop-color="#07040c" stop-opacity=".55"/><stop offset="1" stop-color="#07040c" stop-opacity=".85"/>`}
    </linearGradient>
  </defs>
  <image href="${bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <text x="${head.x}" y="${head.y}" text-anchor="${head.anchor}" font-family="Unbounded" font-weight="700" font-size="${head.size}" letter-spacing="-1" fill="#f5f3ff">${tspans}</text>
  ${chips}
  <text x="${kind === "wide" ? head.x : W / 2}" y="${footY}" text-anchor="${head.anchor}" font-family="Inter" font-weight="500" font-size="${kind === "wide" ? 22 : 26}" fill="#a99bd6" letter-spacing=".5">ghostchat-nfoc.onrender.com</text>
</svg>`;
}

/** The card fonts have no emoji: drop them (and stray joiners/variation selectors) instead of drawing boxes. */
export const plainText = (t: string) => t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u200d\ufe0e\ufe0f]/gu, "").replace(/\s+/g, " ").trim();

/** A bot owner's share card: "Chat with <bot>" in their brand colour. */
export function botCardSvg(opts: { name: string; host: string; color?: string | null; greeting?: string | null; branding?: boolean }): string {
  const W = 1200, H = 630;
  const c = hexColor(opts.color);
  const deep = mix(c, "#05030a", 0.82), mid = mix(c, "#05030a", 0.55), soft = mix(c, "#ffffff", 0.55);
  const mascot = dataUri(asset("og/mascot.jpg"), "image/jpeg");
  let fs = 64;
  const name = plainText(opts.name) || "us";
  let title = wrap(`Chat with ${name}`, 640, fs, 0.68, 2);
  if (title.length > 1 && title[title.length - 1].endsWith("…")) { fs = 50; title = wrap(`Chat with ${name}`, 640, fs, 0.68, 3); }
  const lh = Math.round(fs * 1.16);
  const greeting = plainText(opts.greeting || "");
  const greet = greeting ? wrap(greeting, 640, 28, 0.52, 2) : [];
  const ty = 214 + fs * 0.4 - (title.length - 2) * lh * 0.5;
  const titleSvg = title.map((l, i) => `<tspan x="72" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join("");
  const gy = ty + (title.length - 1) * lh + 60;
  const greetSvg = greet.map((l, i) => `<tspan x="72" dy="${i === 0 ? 0 : 38}">${esc(l)}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="45%" r="55%"><stop offset="0" stop-color="${c}" stop-opacity=".75"/><stop offset=".45" stop-color="${mid}" stop-opacity=".45"/><stop offset="1" stop-color="${deep}" stop-opacity="0"/></radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${soft}"/><stop offset=".5" stop-color="#67e8f9"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${deep}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="930" cy="290" r="168" fill="none" stroke="url(#ring)" stroke-width="5" opacity=".9"/>
  <clipPath id="disc"><circle cx="930" cy="290" r="156"/></clipPath>
  <image href="${mascot}" x="770" y="130" width="320" height="320" clip-path="url(#disc)"/>
  <rect x="72" y="88" width="${Math.round(opts.host.length * 22 * 0.58 + 40)}" height="40" rx="20" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.18)"/>
  <text x="92" y="115" font-family="Inter" font-weight="600" font-size="22" fill="${soft}">${esc(opts.host)}</text>
  <text x="72" y="${ty}" font-family="Unbounded" font-weight="700" font-size="${fs}" letter-spacing="-1" fill="#ffffff">${titleSvg}</text>
  ${greet.length ? `<text x="72" y="${gy}" font-family="Inter" font-weight="500" font-size="28" fill="#ddd6fe">${greetSvg}</text>` : ""}
  <g transform="translate(72 ${H - 110})"><rect width="270" height="60" rx="30" fill="${c}"/><text x="135" y="39" text-anchor="middle" font-family="Inter" font-weight="600" font-size="24" fill="#ffffff">Start chatting →</text></g>
  ${opts.branding !== false ? `<text x="${W - 60}" y="${H - 52}" text-anchor="end" font-family="Inter" font-weight="500" font-size="20" fill="rgba(255,255,255,.55)">Powered by GhostChat</text>` : ""}
</svg>`;
}
