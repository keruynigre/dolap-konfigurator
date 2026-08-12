"""Fix Travina (and other) vanity mirror/desk assets: circular mirror, transparent BG."""
from __future__ import annotations

from collections import deque
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
FURN = ROOT / "assets" / "furniture"
BACKUP = ROOT / "assets" / "_backup_original" / "furniture_fix"


def backup(path: Path) -> None:
    dest = BACKUP / path.parent.name / path.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.copy2(path, dest)
        print(f"backed up {path.name} -> {dest}")


def zero_transparent_rgb(arr: np.ndarray) -> np.ndarray:
    out = arr.copy()
    mask = out[:, :, 3] == 0
    out[mask, 0:3] = 0
    return out


def flood_clear_black(arr: np.ndarray, lum_thresh: float = 28) -> np.ndarray:
    """Flood-fill near-black from edges; transparent + fringe cleanup."""
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float32)
    lum = rgb.mean(axis=2)
    is_dark = lum <= lum_thresh

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_dark[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_dark[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and is_dark[ny, nx]:
                visited[ny, nx] = True
                q.append((nx, ny))

    bg = visited
    out = arr.copy().astype(np.float32)
    out[bg, 3] = 0

    # Soft fringe passes: fade near-bg dark pixels
    for _ in range(2):
        pad = np.pad(bg, 1, constant_values=False)
        neigh = (
            pad[0:-2, 1:-1]
            | pad[2:, 1:-1]
            | pad[1:-1, 0:-2]
            | pad[1:-1, 2:]
            | pad[0:-2, 0:-2]
            | pad[0:-2, 2:]
            | pad[2:, 0:-2]
            | pad[2:, 2:]
        )
        fringe = neigh & ~bg & (lum <= lum_thresh + 35)
        if not fringe.any():
            break
        scale = np.clip((lum[fringe] - lum_thresh) / 35.0, 0, 1)
        out_a = out[:, :, 3]
        out_a[fringe] = out_a[fringe] * scale
        out[:, :, 3] = out_a
        newly = fringe & (out[:, :, 3] < 1)
        bg = bg | newly

    # Despill remaining edge pixels (composited over black)
    pad = np.pad(bg, 1, constant_values=False)
    neigh = (
        pad[0:-2, 1:-1]
        | pad[2:, 1:-1]
        | pad[1:-1, 0:-2]
        | pad[1:-1, 2:]
        | pad[0:-2, 0:-2]
        | pad[0:-2, 2:]
        | pad[2:, 0:-2]
        | pad[2:, 2:]
    )
    edge = neigh & ~bg & (out[:, :, 3] > 0)
    if edge.any():
        er = out[:, :, 0][edge]
        eg = out[:, :, 1][edge]
        eb = out[:, :, 2][edge]
        ea = out[:, :, 3][edge] / 255.0
        elum = (er + eg + eb) / 3.0
        factor = np.clip(elum / 80.0, 0, 1)
        new_a = ea * np.maximum(factor, 0.15)
        boost = np.clip(60.0 / np.maximum(elum, 1.0), 1.0, 2.5)
        out[:, :, 0][edge] = np.clip(er * boost, 0, 255)
        out[:, :, 1][edge] = np.clip(eg * boost, 0, 255)
        out[:, :, 2][edge] = np.clip(eb * boost, 0, 255)
        out[:, :, 3][edge] = np.clip(new_a * 255.0, 0, 255)

    out = np.clip(out, 0, 255).astype(np.uint8)
    return zero_transparent_rgb(out)


def process_desk(path: Path, lum_thresh: float = 28) -> np.ndarray:
    backup(path)
    arr = np.array(Image.open(path).convert("RGBA"))
    out = flood_clear_black(arr, lum_thresh=lum_thresh)
    Image.fromarray(out, "RGBA").save(path, optimize=True)
    return out


def make_circle_mirror(path: Path, size: int = 640, pad: int = 10) -> np.ndarray:
    backup(path)
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    ys, xs = np.where(arr[:, :, 3] > 16)
    if len(xs) == 0:
        raise RuntimeError(f"no opaque pixels in {path}")
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    cropped = im.crop((x0, y0, x1 + 1, y1 + 1))

    cw, ch = cropped.size
    side = max(cw, ch)
    # Stretch oval -> square so the product reads as a true circle
    square_content = cropped.resize((side, side), Image.Resampling.LANCZOS)

    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(square_content, (pad, pad), square_content)

    mask = Image.new("L", (canvas_side, canvas_side), 0)
    draw = ImageDraw.Draw(mask)
    inset = 1
    draw.ellipse(
        (inset, inset, canvas_side - 1 - inset, canvas_side - 1 - inset), fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=0.8))

    out_im = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    out_im.paste(canvas, (0, 0), mask)
    oa = np.array(out_im)
    ma = np.array(mask).astype(np.float32) / 255.0
    oa[:, :, 3] = (oa[:, :, 3].astype(np.float32) * ma).clip(0, 255).astype(np.uint8)
    oa = zero_transparent_rgb(oa)

    final = Image.fromarray(oa, "RGBA")
    if canvas_side != size:
        final = final.resize((size, size), Image.Resampling.LANCZOS)
        final = Image.fromarray(
            zero_transparent_rgb(np.array(final.convert("RGBA"))), "RGBA"
        )

    final.save(path, optimize=True)
    return np.array(final)


def analyze(label: str, arr: np.ndarray) -> None:
    h, w = arr.shape[:2]
    a = arr[:, :, 3]
    lum = arr[:, :, :3].astype(np.float32).mean(axis=2)
    opaque_black = int(np.sum((a > 200) & (lum < 15)))
    edge_band = np.zeros((h, w), dtype=bool)
    edge_band[:5, :] = True
    edge_band[-5:, :] = True
    edge_band[:, :5] = True
    edge_band[:, -5:] = True
    near_black_edge = int(np.sum(edge_band & (a > 200) & (lum < 15)))
    trans = int(np.sum(a == 0))
    corners = [
        tuple(int(v) for v in arr[0, 0]),
        tuple(int(v) for v in arr[0, -1]),
        tuple(int(v) for v in arr[-1, 0]),
        tuple(int(v) for v in arr[-1, -1]),
    ]
    ys, xs = np.where(a > 20)
    if len(xs):
        bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        aspect = bw / bh
    else:
        bw = bh = 0
        aspect = 0.0
    print(f"{label}: {w}x{h} corners={corners}")
    print(
        f"  opaque_black={opaque_black} near_black_edge={near_black_edge} "
        f"transparent={trans} ({100 * trans / (w * h):.1f}%) "
        f"bbox={bw}x{bh} aspect={aspect:.3f}"
    )


def needs_desk_fix(arr: np.ndarray) -> bool:
    a = arr[:, :, 3]
    lum = arr[:, :, :3].astype(np.float32).mean(axis=2)
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    corners_opaque_black = any(
        int(c[3]) > 200 and int(c[0]) < 15 and int(c[1]) < 15 and int(c[2]) < 15
        for c in corners
    )
    edge = np.zeros(a.shape, dtype=bool)
    edge[:3] = True
    edge[-3:] = True
    edge[:, :3] = True
    edge[:, -3:] = True
    nbe = int(np.sum(edge & (a > 200) & (lum < 15)))
    return corners_opaque_black or nbe > 50 or int(np.sum(a == 0)) == 0


def main() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)

    desk_path = FURN / "travina" / "makyaj-masasi.png"
    desk_out = process_desk(desk_path, lum_thresh=28)
    analyze("travina/makyaj-masasi AFTER", desk_out)
    a = desk_out[:, :, 3]
    lum = desk_out[:, :, :3].astype(np.float32).mean(axis=2)
    print(" remaining opaque lum<20:", int(np.sum((a > 200) & (lum < 20))))
    print(" remaining opaque lum<40:", int(np.sum((a > 200) & (lum < 40))))

    mir_path = FURN / "travina" / "makyaj-aynasi.png"
    mir_out = make_circle_mirror(mir_path, size=640, pad=10)
    analyze("travina/makyaj-aynasi AFTER", mir_out)
    a = mir_out[:, :, 3]
    ys, xs = np.where(a > 128)
    cy = (mir_out.shape[0] - 1) / 2
    cx = (mir_out.shape[1] - 1) / 2
    r = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    print(
        f"  opaque radius min/median/max: {r.min():.1f}/{np.median(r):.1f}/{r.max():.1f} "
        f"(half={mir_out.shape[0] / 2:.1f})"
    )

    for series in ("welldora", "monerra", "cappadocia"):
        p = FURN / series / "makyaj-masasi.png"
        if not p.exists():
            continue
        arr = np.array(Image.open(p).convert("RGBA"))
        analyze(f"{series}/makyaj-masasi BEFORE", arr)
        if needs_desk_fix(arr):
            print(f"  -> fixing {series}")
            out = process_desk(p, lum_thresh=28)
            analyze(f"{series}/makyaj-masasi AFTER", out)
        else:
            print("  -> ok, skip")

    print("DONE")


if __name__ == "__main__":
    main()
