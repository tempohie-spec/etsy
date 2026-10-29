"""Tach nen anh thiet ke 2D tren nen trang hoac den (color to alpha).

Dung:
    python remove_bg.py input.png [output.png] [--bg auto|white|black] [--tolerance 0.06]
    python remove_bg.py thu_muc_anh/ thu_muc_ra/
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def detect_background(rgb):
    """Doan nen trang hay den tu cac pixel o vien anh."""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return "white" if border.mean() >= 127.5 else "black"


def remove_background(img, bg="auto", tolerance=0.06, opaque=0.8):
    """Tra ve anh RGBA nen trong suot. Giu duoc vien mo va net anti-alias."""
    rgba = np.asarray(img.convert("RGBA"), dtype=np.float32) / 255.0
    rgb, a_in = rgba[..., :3], rgba[..., 3:]
    if bg == "auto":
        bg = detect_background((rgb * 255).astype(np.uint8))

    if bg == "white":
        alpha = (1.0 - rgb).max(axis=-1, keepdims=True)
    else:
        alpha = rgb.max(axis=-1, keepdims=True)

    # Duoi tolerance: nen hoan toan (bo nhieu JPEG). Tu opaque tro len: dac hoan toan,
    # tranh mau vua/nhat bi ban trong suot. Giua hai moc: vien mo anti-alias.
    alpha = np.clip((alpha - tolerance) / (opaque - tolerance), 0.0, 1.0)

    safe = np.maximum(alpha, 1e-6)
    fg = 1.0 - (1.0 - rgb) / safe if bg == "white" else rgb / safe
    fg = np.clip(fg, 0.0, 1.0)
    fg[alpha[..., 0] == 0] = 0.0

    out = np.concatenate([fg, alpha * a_in], axis=-1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def process(src, dst, bg="auto", tolerance=0.06, opaque=0.8):
    img = Image.open(src)
    remove_background(img, bg, tolerance, opaque).save(dst, "PNG")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="Anh hoac thu muc anh")
    p.add_argument("output", nargs="?", help="Anh PNG hoac thu muc dau ra")
    p.add_argument("--bg", choices=["auto", "white", "black"], default="auto")
    p.add_argument("--tolerance", type=float, default=0.06, help="0 den 0.5, tang neu con vet nen")
    p.add_argument("--opaque", type=float, default=0.8, help="Muc khac nen de coi la dac hoan toan (1 = chi tach mau thuan, giam neu thiet ke co mau nhat)")
    a = p.parse_args(argv)

    src = Path(a.input)
    if src.is_dir():
        out_dir = Path(a.output) if a.output else src / "tach_nen"
        out_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(f for f in src.iterdir() if f.suffix.lower() in EXTS)
        for f in files:
            process(f, out_dir / (f.stem + ".png"), a.bg, a.tolerance, a.opaque)
            print("OK", f.name)
        print(f"Xong {len(files)} anh -> {out_dir}")
    else:
        dst = Path(a.output) if a.output else src.with_name(src.stem + "_nobg.png")
        process(src, dst, a.bg, a.tolerance, a.opaque)
        print("Xong ->", dst)


if __name__ == "__main__":
    sys.exit(main())
