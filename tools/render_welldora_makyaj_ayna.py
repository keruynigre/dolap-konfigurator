"""Redraw Welldora makeup mirror: keep barrel silhouette, realistic glass + thin wood rim."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "furniture" / "welldora" / "makyaj-aynasi.png"
OUT = ROOT / "assets" / "furniture" / "welldora" / "makyaj-aynasi.png"
SCALE = 3  # render supersampled; final save at 2× original (1242×820)


def soft_mask_from_src(src: Image.Image, scale: int) -> Image.Image:
    a = np.asarray(src.split()[-1]).astype(np.float32)
    # harden then upscale with AA
    hard = np.where(a > 48, 255.0, 0.0)
    m0 = Image.fromarray(hard.astype(np.uint8), "L")
    # slight morphological close to fill pinholes
    m0 = m0.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    w, h = src.size[0] * scale, src.size[1] * scale
    m = m0.resize((w, h), Image.Resampling.LANCZOS)
    m = m.filter(ImageFilter.GaussianBlur(radius=scale * 0.55))
    arr = np.asarray(m).astype(np.float32)
    # crisp but AA edge
    arr = np.clip((arr - 70) / 90.0, 0, 1) * 255
    return Image.fromarray(arr.astype(np.uint8), "L")


def inset_mask(mask: Image.Image, px: int) -> Image.Image:
    """Erode mask by ~px using min filter."""
    k = max(3, px * 2 + 1)
    if k % 2 == 0:
        k += 1
    return mask.filter(ImageFilter.MinFilter(size=k))


def main():
    src = Image.open(SRC).convert("RGBA")
    w0, h0 = src.size
    w, h = w0 * SCALE, h0 * SCALE
    mask = soft_mask_from_src(src, SCALE)

    # Frame thickness in output pixels
    frame_px = max(5, int(round(7 * SCALE / 2)))  # ~14px at scale 4
    glass_mask = inset_mask(mask, frame_px)

    # --- wood frame (Welldora walnut-ish) ---
    frame = np.zeros((h, w, 4), dtype=np.float32)
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    # horizontal grain like vanity drawers
    grain = (
        0.92
        + 0.08 * np.sin((yy * h / SCALE) * 0.55 + xx * 2.2)
        + 0.04 * np.sin((yy * h / SCALE) * 1.8)
    )
    wood = np.array([146, 108, 78], dtype=np.float32)[None, None, :] * grain[:, :, None]
    wood = wood * (0.94 + 0.10 * (1 - xx)[:, :, None])  # slight L/R shade
    # brass-ish highlight on outer rim later
    ma = np.asarray(mask).astype(np.float32) / 255.0
    ga = np.asarray(glass_mask).astype(np.float32) / 255.0
    frame_a = np.clip(ma - ga, 0, 1)
    frame[..., :3] = wood
    frame[..., 3] = frame_a * 255

    # thin brass edge on outer perimeter
    edge = np.asarray(mask.filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
    edge = np.asarray(
        Image.fromarray((np.clip(edge, 0, 1) * 255).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(radius=SCALE * 0.7)
        )
    ).astype(np.float32) / 255.0
    brass = np.array([201, 168, 110], dtype=np.float32)
    frame[..., :3] = frame[..., :3] * (1 - edge[:, :, None] * 0.55) + brass * (edge[:, :, None] * 0.55)

    # --- glass ---
    gy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    gx = np.linspace(0, 1, w, dtype=np.float32)[None, :]

    # cool silver mirror base
    c_hi = np.array([248, 250, 252], dtype=np.float32)
    c_mid = np.array([186, 192, 198], dtype=np.float32)
    c_lo = np.array([118, 114, 116], dtype=np.float32)
    t = gy ** 0.85
    base = c_hi[None, None, :] * (1 - t)[:, :, None] + c_mid[None, None, :] * t[:, :, None]
    base = np.broadcast_to(base, (h, w, 3)).copy()
    base = base * (1 - 0.28 * gx[:, :, None]) + c_lo[None, None, :] * (0.28 * gx[:, :, None])

    # soft room reflection bands (horizontal)
    for y0, amp, sig in [(0.18, 28, 0.06), (0.42, 16, 0.08), (0.72, 12, 0.10)]:
        band = np.exp(-((gy - y0) ** 2) / (2 * sig ** 2))
        base = base + band[:, :, None] * amp

    # vertical specular per leaf (left + right of seam)
    for cx, amp in [(0.28, 34), (0.72, 26)]:
        streak = (
            np.exp(-((gx - cx) ** 2) / (2 * 0.055 ** 2))
            * np.exp(-((gy - 0.38) ** 2) / (2 * 0.32 ** 2))
            * (0.55 + 0.45 * (1 - gy))
        )
        base = base + streak[:, :, None] * amp

    # subtle warm floor bounce at bottom
    warm = (np.clip((gy - 0.55) / 0.45, 0, 1) ** 1.2)[:, :, None]
    base = base * (1 - warm * 0.18) + np.array([140, 128, 118], dtype=np.float32) * (warm * 0.18)

    rng = np.random.default_rng(9)
    base = base + rng.normal(0, 0.9, (h, w, 1)).astype(np.float32)

    glass = np.zeros((h, w, 4), dtype=np.float32)
    glass[..., :3] = np.clip(base, 0, 255)
    glass[..., 3] = ga * 255

    # inner bevel on glass edge
    g_edge = np.asarray(glass_mask.filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
    g_edge = np.asarray(
        Image.fromarray((np.clip(g_edge, 0, 1) * 255).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(radius=SCALE * 0.9)
        )
    ).astype(np.float32) / 255.0
    glass[..., :3] = glass[..., :3] * (1 - g_edge[:, :, None] * 0.25) + np.array([255, 255, 255]) * (
        g_edge[:, :, None] * 0.12
    )

    # --- center hinge / seam (two panels) ---
    cx = w // 2
    seam_w = max(3, int(2.5 * SCALE))
    for dx in range(-seam_w, seam_w + 1):
        x = cx + dx
        if not (0 <= x < w):
            continue
        fall = 1.0 - abs(dx) / (seam_w + 0.4)
        # dark groove
        glass[:, x, :3] = glass[:, x, :3] * (1 - 0.42 * fall) + np.array([55, 52, 48]) * (0.42 * fall)
    # bright hairline
    if 0 <= cx < w:
        glass[:, cx, :3] = glass[:, cx, :3] * 0.45 + np.array([230, 228, 220]) * 0.55
    # tiny hinge dots along seam
    for fy in (0.18, 0.50, 0.82):
        y = int(h * fy)
        r = max(2, SCALE)
        for yy in range(y - r, y + r + 1):
            for xx in range(cx - r, cx + r + 1):
                if 0 <= yy < h and 0 <= xx < w:
                    if (xx - cx) ** 2 + (yy - y) ** 2 <= r * r:
                        glass[yy, xx, :3] = np.array([170, 150, 105])
                        glass[yy, xx, 3] = max(glass[yy, xx, 3], ga[yy, xx] * 255)

    # compose
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out = Image.alpha_composite(out, Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), "RGBA"))
    out = Image.alpha_composite(out, Image.fromarray(np.clip(glass, 0, 255).astype(np.uint8), "RGBA"))

    # very soft contact shadow under (outside silhouette)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sm = mask.filter(ImageFilter.GaussianBlur(radius=SCALE * 5))
    sa = np.asarray(sm).astype(np.float32) * 0.18
    # shift down
    shifted = np.zeros_like(sa)
    dy = int(SCALE * 3)
    shifted[dy:, :] = sa[:-dy, :]
    shifted *= 1.0 - ma * 0.95
    sh = np.zeros((h, w, 4), dtype=np.float32)
    sh[..., 3] = shifted
    shadow = Image.fromarray(np.clip(sh, 0, 255).astype(np.uint8), "RGBA")
    out = Image.alpha_composite(shadow, out)

    # mild sharpen
    out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))
    # Store at ~2× original for sharp UI without huge files
    target = (1242, 820)
    if out.size != target:
        out = out.resize(target, Image.Resampling.LANCZOS)
    out.save(OUT, optimize=True)
    print("wrote", OUT, out.size, OUT.stat().st_size)


if __name__ == "__main__":
    main()
