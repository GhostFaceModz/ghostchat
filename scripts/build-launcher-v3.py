#!/usr/bin/env python3
"""Compose v3 launcher SVGs (icon × style) and small dashboard previews.

Regenerates public/launcher/v3 from the approved bubble-icons-v3 renderer.
The generated files are committed so Render does not need this script at build time.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("/workspace/ghostchat-review/bubble-icons-v3")
OUT = ROOT / "public" / "launcher" / "v3"
PREV = OUT / "previews"

sys.path.insert(0, str(SRC))
from render_v3 import (  # noqa: E402
    ICONS,
    chrome_glass,
    chrome_gradient,
    chrome_jewel,
    chrome_outline,
    close_launcher,
    css_block,
    defs,
    support_path,
    wrap_glyph,
)

ICON_IDS = [
    ("jewel-headset", "01-headset"),
    ("ghost-headset", "02-ghost-headset"),
    ("chat-typing", "03-chat-typing"),
    ("sparkle-chat", "04-sparkle-chat"),
    ("ghost-mark", "05-ghost-mark"),
    ("message-check", "06-message-check"),
]

# Internal style id -> chrome builder. "jewel" is the approved basic orb.
STYLES = [
    ("jewel", "jewel", chrome_jewel, 64, 64, "0 0 64 64"),
    ("glass-shine", "glass", chrome_glass, 64, 64, "0 0 64 64"),
    ("gradient-shine", "gradient", chrome_gradient, 64, 64, "0 0 64 64"),
    ("outline-glow", "outline", chrome_outline, 64, 64, "0 0 64 64"),
    ("pill-support", "pill", None, 176, 64, "0 0 176 64"),
]

# Pad so glow/shadow is not clipped when the SVG is used as an <img>.
ORB_PAD = 10
PILL_PAD_X, PILL_PAD_Y = 16, 12


def prefix_for(icon: str, style: str) -> str:
    raw = re.sub(r"[^a-z0-9]", "", icon + style)
    return raw[:24] or "v3"


def svg_doc(title: str, body: str, vb: str, width: int, height: int) -> str:
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{width}" height="{height}"'
        f' role="img" aria-label="GhostChat — {title}" overflow="visible">\n'
        f"  <title>GhostChat — {title}</title>\n"
        f"{body}\n"
        f"</svg>\n"
    )


def pad_viewbox(width: int, height: int, style: str) -> tuple[str, int, int]:
    if style == "pill-support":
        vb = f"{-PILL_PAD_X} {-PILL_PAD_Y} {width + 2 * PILL_PAD_X} {height + 2 * PILL_PAD_Y}"
        return vb, width + 2 * PILL_PAD_X, height + 2 * PILL_PAD_Y
    vb = f"{-ORB_PAD} {-ORB_PAD} {width + 2 * ORB_PAD} {height + 2 * ORB_PAD}"
    return vb, width + 2 * ORB_PAD, height + 2 * ORB_PAD


def pill_body(p: str, glyph: str, support_d: str, support_w: float, support_cap: float) -> str:
    text_x = 58.5
    text_y = 32.2
    shine = f"""
      <g clip-path="url(#{p}pillClip)">
        <g class="pill-shine" style="transform:translateX(-130px)">
          <g transform="rotate(26 88 32)">
            <rect x="-10" y="-28" width="32" height="120" fill="url(#{p}shineGrad)"/>
          </g>
        </g>
      </g>"""
    return f"""
  <ellipse class="pill-glow" cx="88" cy="32" rx="92" ry="36" fill="url(#{p}ambient)"/>
  <g class="pill-launcher">
    <rect x="6" y="8" width="164" height="48" rx="24" fill="url(#{p}pillFill)" filter="url(#{p}pillShadow)"/>
    <rect x="6" y="8" width="164" height="48" rx="24" fill="url(#{p}ctaShade)"/>
    <rect x="7.1" y="9.1" width="161.8" height="45.8" rx="22.9" fill="none" stroke="#FFFFFF" stroke-width="1.05" opacity="0.32"/>
    <g clip-path="url(#{p}pillClip)">
      <ellipse cx="48" cy="18" rx="70" ry="22" fill="url(#{p}spec)"/>
      <rect x="6" y="8" width="164" height="48" fill="url(#{p}glassSheen)"/>
    </g>
    <path d="M22 16.2C40 10.6 70 9.2 100 11.4C124 13.2 146 16.6 158 21.5"
          fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.36"/>
    {shine}
    <g transform="translate(4,0)">
      {glyph}
    </g>
    <g transform="translate({text_x:.3f}, {text_y:.3f})">
      <path d="{support_d}" fill="#FFFFFF"/>
    </g>
  </g>
"""


def compose(icon_id: str, src_slug: str, glyph_fn, scale: float, dy: float, style_id: str, kind: str, chrome_fn, w: int, h: int, support) -> str:
    p = prefix_for(icon_id, style_id)
    if style_id == "pill-support":
        # Pill uses a slightly tighter glyph so it sits in the left well.
        glyph = wrap_glyph(glyph_fn(), min(scale, 1.18), 0.15)
        body = defs(p, "pill") + "\n  " + css_block() + pill_body(p, glyph, *support)
    else:
        glyph = wrap_glyph(glyph_fn(), scale, dy)
        body = defs(p, kind) + "\n  " + css_block() + chrome_fn(p) + "    " + glyph + "\n" + close_launcher()
    title = f"{icon_id} · {style_id}"
    vb, out_w, out_h = pad_viewbox(w, h, style_id)
    return svg_doc(title, body, vb, out_w, out_h)


def write_previews() -> None:
    """Small PNG tiles for the dashboard picker, derived from the approved 1024 stills."""
    try:
        from PIL import Image
    except ImportError:
        print("PIL missing; skipping PNG previews")
        return
    src = SRC / "png"
    PREV.mkdir(parents=True, exist_ok=True)
    mapping = {
        "jewel-headset": "01-headset-dark-1024.png",
        "ghost-headset": "02-ghost-headset-dark-1024.png",
        "chat-typing": "03-chat-typing-dark-1024.png",
        "sparkle-chat": "04-sparkle-chat-dark-1024.png",
        "ghost-mark": "05-ghost-mark-dark-1024.png",
        "message-check": "06-message-check-dark-1024.png",
        "jewel": "05-ghost-mark-dark-1024.png",
        "glass-shine": "style-glass-dark-1024.png",
        "gradient-shine": "style-gradient-shine-dark-1024.png",
        "outline-glow": "style-outline-glow-dark-1024.png",
        "pill-support": "style-pill-support-dark-1024.png",
    }
    for key, fname in mapping.items():
        im = Image.open(src / fname).convert("RGBA")
        # Pill is wider; others are square orbs.
        size = (192, 96) if key == "pill-support" else (128, 128)
        im = im.resize(size, Image.Resampling.LANCZOS)
        dest = PREV / f"{key}.png"
        im.save(dest, "PNG", optimize=True)
        print("preview", dest, dest.stat().st_size)


def main() -> None:
    try:
        support = support_path()
    except Exception as exc:
        print("support_path failed, falling back:", exc)
        support = ("M0 0", 56.0, 11.0)

    glyphs = {slug: (fn, scale, dy) for slug, _title, fn, scale, dy in ICONS}
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for icon_id, src_slug in ICON_IDS:
        glyph_fn, scale, dy = glyphs[src_slug]
        for style_id, kind, chrome_fn, w, h, _vb in STYLES:
            svg = compose(icon_id, src_slug, glyph_fn, scale, dy, style_id, kind, chrome_fn, w, h, support)
            dest = OUT / f"{icon_id}--{style_id}.svg"
            dest.write_text(svg)
            n += 1
    write_previews()
    print(f"wrote {n} svgs in {OUT}")


if __name__ == "__main__":
    main()
