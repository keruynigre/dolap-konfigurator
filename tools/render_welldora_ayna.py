"""Render a crisp Welldora mirror door sprite (same silhouette as ASSETS.ayna)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "doors" / "welldora"
# 2× original canvas; crop [480,198,850,1850]
W, H = 1334, 2002
DOOR = (480, 198, 850, 1888)


def render(scale: int = 3) -> Image.Image:
    sw, sh = W * scale, H * scale
    x0, y0, x1, y1 = [v * scale for v in DOOR]

    # Slightly thicker frame so it stays readable at ~100px slot width
    frame = max(4 * scale, int(round(7.0 * scale)))
    plinth_h = max(8 * scale, int(round(14 * scale)))
    glass = (x0 + frame, y0 + frame, x1 - frame, y1 - plinth_h - max(1, scale))

    # --- wood frame ---
    body = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(112, 86, 68, 255))

    fa = np.asarray(body).astype(np.float32)
    yy = np.linspace(0, 1, sh, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, sw, dtype=np.float32)[None, :]
    # vertical wood grain (subtle)
    grain = 0.96 + 0.08 * np.sin((xx * sw / scale) * 0.35 + yy * 4.0)
    grain *= 0.97 + 0.06 * np.sin((xx * sw / scale) * 1.1)
    # left rim lighter, right darker
    side = 0.90 + 0.18 * (1.0 - xx)
    top = 1.0 + 0.12 * np.clip((y0 + frame * 1.5 - np.arange(sh)[:, None]) / (frame * 1.5 + 1), 0, 1)
    for c in range(3):
        fa[..., c] *= grain * side * top
    # punch glass + plinth
    mask = Image.new("L", (sw, sh), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle([glass[0], glass[1], glass[2] - 1, glass[3] - 1], fill=255)
    md.rectangle([x0 + frame // 3, y1 - plinth_h, x1 - frame // 3 - 1, y1 - 1], fill=255)
    m = np.asarray(mask)
    fa[m > 0, 3] = 0
    fa = np.clip(fa, 0, 255)
    frame_img = Image.fromarray(fa.astype(np.uint8), "RGBA")

    # --- glass ---
    gw, gh = glass[2] - glass[0], glass[3] - glass[1]
    gy = np.linspace(0, 1, gh, dtype=np.float32)[:, None]
    gx = np.linspace(0, 1, gw, dtype=np.float32)[None, :]

    c_top = np.array([252, 253, 255], dtype=np.float32)
    c_mid = np.array([200, 206, 212], dtype=np.float32)
    c_bot = np.array([126, 120, 122], dtype=np.float32)
    c_warm = np.array([138, 122, 114], dtype=np.float32)

    t = gy ** 0.9
    t1 = np.clip(t / 0.42, 0, 1)
    t2 = np.clip((t - 0.42) / 0.58, 0, 1)
    upper = c_top[None, None, :] * (1 - t1)[:, :, None] + c_mid[None, None, :] * t1[:, :, None]
    lower = c_mid[None, None, :] * (1 - t2)[:, :, None] + c_bot[None, None, :] * t2[:, :, None]
    base = np.where((t < 0.42)[:, :, None], upper, lower)
    base = np.broadcast_to(base, (gh, gw, 3)).copy()
    warm = (np.clip((t - 0.55) / 0.45, 0, 1) ** 1.15)[:, :, None]
    base = base * (1 - warm * 0.32) + c_warm[None, None, :] * (warm * 0.32)

    streak = (
        np.exp(-((gx - 0.36) ** 2) / (2 * 0.05 ** 2))
        * np.exp(-((gy - 0.20) ** 2) / (2 * 0.26 ** 2))
        * (0.6 + 0.4 * (1 - gy))
    )
    base = base + streak[:, :, None] * np.array([38, 40, 42], dtype=np.float32)
    bloom = np.exp(-(((gx - 0.20) ** 2) / (2 * 0.16 ** 2) + ((gy - 0.10) ** 2) / (2 * 0.14 ** 2)))
    base = base + bloom[:, :, None] * np.array([22, 24, 26], dtype=np.float32)

    edge = np.minimum(np.minimum(gx, 1 - gx), np.minimum(gy, 1 - gy))
    bevel = np.clip(1.0 - edge / 0.04, 0, 1) ** 1.35
    base = base * (1 - bevel[:, :, None] * 0.28)

    # blue-noise-ish dither against banding
    rng = np.random.default_rng(21)
    base = base + rng.normal(0, 1.35, size=(gh, gw, 1)).astype(np.float32)

    g = np.zeros((gh, gw, 4), dtype=np.float32)
    g[..., :3] = np.clip(base, 0, 255)
    g[..., 3] = 255
    glass_img = Image.fromarray(g.astype(np.uint8), "RGBA")

    lip = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lip)
    ld.rectangle([0, 0, gw - 1, max(1, scale)], fill=(255, 255, 255, 85))
    ld.rectangle([0, 0, max(1, scale), gh - 1], fill=(255, 255, 255, 40))
    ld.rectangle([gw - max(1, scale) - 1, 0, gw - 1, gh - 1], fill=(35, 32, 30, 55))
    glass_img = Image.alpha_composite(glass_img, lip)

    # --- plinth ---
    plinth = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plinth)
    px0, py0 = x0 + frame // 3, y1 - plinth_h
    px1, py1 = x1 - frame // 3, y1
    pd.rectangle([px0, py0, px1 - 1, py1 - 1], fill=(238, 236, 232, 255))
    pd.rectangle([px0, py0, px1 - 1, py0 + max(1, scale)], fill=(188, 184, 178, 255))

    # outer highlight on frame
    rim = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.rectangle([x0, y0, x1 - 1, y0 + max(1, scale)], fill=(210, 180, 155, 100))
    rd.rectangle([x0, y0, x0 + max(1, scale), y1 - plinth_h], fill=(200, 168, 142, 70))

    out = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    out = Image.alpha_composite(out, frame_img)
    out.paste(glass_img, (glass[0], glass[1]), glass_img)
    out = Image.alpha_composite(out, plinth)
    out = Image.alpha_composite(out, rim)

    # mild sharpen after downscale
    out = out.resize((W, H), Image.Resampling.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    im = render(scale=3)
    webp = OUT_DIR / "ayna.webp"
    im.save(webp, "WEBP", quality=96, method=6)
    preview = OUT_DIR / "_preview_slot.png"
    im.crop((480, 198, 850, 1850)).resize((185, 826), Image.Resampling.LANCZOS).save(preview)
    print("wrote", webp, webp.stat().st_size, im.size)


if __name__ == "__main__":
    main()
