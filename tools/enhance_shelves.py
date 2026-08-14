"""Paint thicker, beveled shelves onto deshadowed cabinet body assets."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PREVIEW = ASSETS / "_shelf_preview"

# Explicit shelf bands: (y, x0_frac, x1_frac)
# Measured from original body assets (890px tall).
SHELVES: dict[str, list[tuple[int, float, float]]] = {
    "body1.webp": [
        (158, 0.02, 0.98),
        (305, 0.02, 0.98),
        (453, 0.02, 0.98),
        (587, 0.02, 0.98),
        (722, 0.02, 0.98),
        (864, 0.02, 0.98),
    ],
    "body2.webp": [
        (121, 0.02, 0.98),
        (492, 0.02, 0.98),
    ],
    "body3.webp": [
        # left column cubbies
        (159, 0.02, 0.33),
        (306, 0.02, 0.33),
        (452, 0.02, 0.33),
        (586, 0.02, 0.33),
        (720, 0.02, 0.33),
        (861, 0.02, 0.33),
        # right column
        (160, 0.33, 0.98),
        (592, 0.33, 0.98),
        (862, 0.33, 0.98),
    ],
    "body2-cekmece.webp": [
        (123, 0.02, 0.98),
        (594, 0.02, 0.98),  # shelf above drawers
        # drawer seams (thinner treatment)
        (677, 0.02, 0.98),
        (762, 0.02, 0.98),
        (864, 0.02, 0.98),
    ],
    "body3-cekmece.webp": [
        (159, 0.02, 0.33),
        (306, 0.02, 0.33),
        (452, 0.02, 0.33),
        (586, 0.02, 0.33),
        (720, 0.02, 0.33),
        (861, 0.02, 0.33),
        (160, 0.33, 0.98),
        (594, 0.33, 0.98),
        (676, 0.33, 0.98),
        (761, 0.33, 0.98),
        (862, 0.33, 0.98),
    ],
}

# drawer seam ys get thinner board treatment
DRAWER_SEAMS = {
    "body2-cekmece.webp": {677, 762, 864},
    "body3-cekmece.webp": {676, 761, 862},
}


def enhance(im: Image.Image, shelves: list[tuple[int, float, float]], drawer_ys: set[int]) -> Image.Image:
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    out = arr.copy()

    # Global warm board fallback; per-shelf colors sampled from nearby bright wood
    hi0 = np.array([252, 249, 243], dtype=np.float32)
    board0 = np.array([236, 230, 220], dtype=np.float32)

    for y, fx0, fx1 in shelves:
        x0 = int(w * fx0)
        x1 = int(w * fx1)
        x0 = max(1, x0)
        x1 = min(w - 1, x1)
        if x1 - x0 < 10:
            continue

        # sample local material just below the shelf line
        sy0 = min(h - 2, y + 8)
        sy1 = min(h - 1, y + 28)
        sample = arr[sy0:sy1, x0:x1]
        if sample.size:
            sl = (
                0.2126 * sample[..., 0]
                + 0.7152 * sample[..., 1]
                + 0.0722 * sample[..., 2]
            )
            pick = sample[sl >= np.percentile(sl, 60)]
            board = np.median(pick, axis=0) if len(pick) else board0
        else:
            board = board0
        hi = np.clip(board * 1.08 + 18, 0, 255)
        mid = board * 0.9
        dark = board * 0.78

        is_drawer = y in drawer_ys
        thick = 5 if is_drawer else 10
        y0 = int(np.clip(y - thick // 2, 1, h - thick - 2))
        y1 = y0 + thick - 1

        for i, yy in enumerate(range(y0, y1 + 1)):
            t = i / max(1, thick - 1)
            if t < 0.14:
                col = hi
            elif t < 0.38:
                col = hi * 0.4 + board * 0.6
            elif t < 0.72:
                col = board * 0.75 + mid * 0.25
            else:
                col = mid * 0.45 + dark * 0.55

            row = np.broadcast_to(col, (x1 - x0, 3)).astype(np.float32).copy()
            # keep a whisper of original texture so boards feel less pasted
            row = 0.82 * row + 0.18 * out[yy, x0:x1]
            edge = min(5, max(2, (x1 - x0) // 10))
            for e in range(edge):
                f = 0.18 * (1 - e / edge)
                row[e] *= 1 - f
                row[-(e + 1)] *= 1 - f

            alpha = 0.9 if is_drawer else 0.95
            out[yy, x0:x1] = out[yy, x0:x1] * (1 - alpha) + row * alpha

        # top catch-light + underside lip
        out[y0, x0:x1] = out[y0, x0:x1] * 0.25 + hi * 0.75
        out[y1, x0:x1] = out[y1, x0:x1] * 0.4 + dark * 0.6

        # soft contact shadow under board
        strengths = (
            [0.18, 0.12, 0.07, 0.04]
            if is_drawer
            else [0.3, 0.22, 0.14, 0.08, 0.045, 0.02]
        )
        for k, s in enumerate(strengths):
            yy = y1 + 1 + k
            if yy >= h - 1:
                break
            out[yy, x0:x1] = out[yy, x0:x1] * (1 - s) - 6.0 * s

        for k, s in enumerate([0.08, 0.03]):
            yy = y0 - 1 - k
            if yy >= 1:
                out[yy, x0:x1] *= 1 - s

        # shelf/upright joints
        for x in (x0, x0 + 1, x1 - 2, x1 - 1):
            if 1 <= x < w - 1:
                out[y0 : min(h - 1, y1 + 3), x] *= 0.86

    # vertical divider / side wall readability
    for x, s in [(1, 0.05), (2, 0.09), (3, 0.05), (w - 2, 0.05), (w - 3, 0.08), (w - 4, 0.04)]:
        if 0 <= x < w:
            out[:, x] *= 1 - s

    # body3 center divider emphasis
    if w > 400:
        cx = int(w * 0.33)
        for x, s in [(cx - 1, 0.06), (cx, 0.11), (cx + 1, 0.06)]:
            if 0 <= x < w:
                out[:, x] *= 1 - s

    out = np.clip(out, 0, 255).astype(np.uint8)
    # tiny sharpen on shelf edges
    img = Image.fromarray(out, "RGB")
    return img


def main(write_assets: bool = False, preview: bool = True) -> None:
    if preview:
        PREVIEW.mkdir(parents=True, exist_ok=True)

    for name, shelves in SHELVES.items():
        src = ASSETS / name
        im = Image.open(src).convert("RGB")
        result = enhance(im, shelves, DRAWER_SEAMS.get(name, set()))
        print(name, "shelves", len(shelves))

        if preview:
            result.save(PREVIEW / name, "WEBP", quality=93)
            vis = im.copy()
            dr = ImageDraw.Draw(vis)
            for y, fx0, fx1 in shelves:
                x0, x1 = int(im.width * fx0), int(im.width * fx1)
                dr.line([(x0, y), (x1, y)], fill=(220, 40, 40), width=2)
            vis.save(PREVIEW / f"det_{name.replace('.webp', '.jpg')}", quality=90)
            w, h = im.size
            side = Image.new("RGB", (w * 2 + 8, h), (28, 28, 28))
            side.paste(im, (0, 0))
            side.paste(result, (w + 8, 0))
            side.resize(
                (min(960, side.width), int(side.height * min(960, side.width) / side.width)),
                Image.LANCZOS,
            ).save(PREVIEW / f"cmp_{name.replace('.webp', '.jpg')}", quality=90)

        if write_assets:
            result.save(src, "WEBP", quality=93)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--write", action="store_true")
    p.add_argument("--no-preview", action="store_true")
    args = p.parse_args()
    main(write_assets=args.write, preview=not args.no_preview)
