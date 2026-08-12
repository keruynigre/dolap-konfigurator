"""Remove baked-in interior shadows from cabinet body webp assets."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
BACKUP = ASSETS / "_backup_original"
NAMES = [
    "body1.webp",
    "body2.webp",
    "body3.webp",
    "body2-cekmece.webp",
    "body3-cekmece.webp",
]


def luminance(arr: np.ndarray) -> np.ndarray:
    return 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]


def deshadow(im: Image.Image) -> Image.Image:
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    lum = luminance(arr)
    chroma = arr.max(axis=2) - arr.min(axis=2)

    white = (lum > 200) & (chroma < 28)
    white = np.asarray(
        Image.fromarray((white.astype(np.uint8) * 255), "L").filter(ImageFilter.MaxFilter(3))
    ) > 0
    white = white | ((lum > 225) & (chroma < 40))
    interior = ~white

    vals = lum[interior]
    thr = np.percentile(vals, 72)
    ref_mask = interior & (lum >= thr)
    target = np.median(arr[ref_mask], axis=0)
    target_lum = float(luminance(target[None, None, :])[0, 0])

    tiny = Image.fromarray(arr.astype(np.uint8)).resize(
        (max(4, w // 22), max(8, h // 22)), Image.BILINEAR
    )
    illum = np.asarray(tiny.resize((w, h), Image.BILINEAR), dtype=np.float32)
    illum = np.asarray(
        Image.fromarray(illum.astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=max(12, w // 7))
        ),
        dtype=np.float32,
    )
    illum = np.maximum(illum, 5.0)

    gain = np.clip(target[None, None, :] / illum, 0.45, 3.8)
    corrected = arr * gain

    blur = np.asarray(
        Image.fromarray(arr.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=1.8)),
        dtype=np.float32,
    )
    detail = arr - blur
    blur_c = np.asarray(
        Image.fromarray(np.clip(corrected, 0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=2.5)
        ),
        dtype=np.float32,
    )
    rebuilt = 0.90 * target[None, None, :] + 0.10 * blur_c + detail * 1.2

    mask_f = np.asarray(
        Image.fromarray((interior.astype(np.uint8) * 255), "L").filter(
            ImageFilter.GaussianBlur(radius=1.2)
        ),
        dtype=np.float32,
    ) / 255.0
    out = arr * (1 - mask_f[..., None]) + rebuilt * mask_f[..., None]

    for _ in range(2):
        lum2 = luminance(out)
        bright = Image.fromarray(np.clip(lum2, 0, 255).astype(np.uint8), "L")
        bright = bright.filter(ImageFilter.MaxFilter(size=max(3, (w // 10) | 1)))
        bright = bright.filter(ImageFilter.GaussianBlur(radius=max(4, w // 14)))
        local_bright = np.maximum(np.asarray(bright, dtype=np.float32), target_lum * 0.92)
        deficit = (local_bright - lum2) / np.maximum(local_bright, 1.0)
        lift = (np.clip(deficit, 0, 1) * interior.astype(np.float32)) ** 0.75
        scale = np.clip(
            1.0 + 0.95 * lift * (local_bright / np.maximum(lum2, 1.0) - 1.0),
            1.0,
            2.6,
        )
        boosted = out * scale[..., None]
        out = boosted * (1 - 0.55 * lift[..., None]) + target[None, None, :] * (
            0.55 * lift[..., None]
        )
        out = np.clip(out + detail * (0.25 * lift[..., None]), 0, 255)

    out = np.where(white[..., None], arr, out)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        src = ASSETS / name
        bak = BACKUP / name
        if not bak.exists():
            shutil.copy2(src, bak)
        result = deshadow(Image.open(bak))
        result.save(src, "WEBP", quality=93)
        print("updated", name)


if __name__ == "__main__":
    main()
