"""Tach nen anh thiet ke 2D tren nen trang hoac den (color to alpha).

Dung:
    python remove_bg.py input.png [output.png] [--bg auto|white|black] [--tolerance 0.06]
    python remove_bg.py thu_muc_anh/ thu_muc_ra/ --connected --close-gaps
"""
import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
SUFFIX = "_done"

GROW = 2          # px mo rong quanh vung nen de xu ly vien mo anti-alias
CLOSE = 2         # px khe ho duoc bit khi bat close_gaps
EDGE_REACH = 3    # px toi da de lay mau vien tu vung dac gan nhat
CONNECT_MIN = 0.08


@dataclass
class Options:
    bg: str = "auto"            # auto | white | black
    tolerance: float = 0.06     # duoi muc nay coi la nen hoan toan
    opaque: float = 0.8         # tu muc nay tro len coi la dac hoan toan
    connected: bool = False     # chi xoa nen noi voi mep anh (giu phan trang/den ben trong)
    close_gaps: bool = False    # bit khe ho nho trong net ve de nen khong ro vao trong
    smooth: float = 0.0         # px; lam min vien bang quang mem phia ngoai mep (0 = tat)
    bridge: int = 0             # px: nen xuyen qua net manh hon 2*bridge px (day den, net chu); 0 = tat


def auto_bridge(size):
    """Do day xuyen net manh tu dong: khoang 1 px cho moi 1000 px canh dai cua anh (1 den 4)."""
    return min(4, max(1, round(max(size) / 1000)))


def detect_background(rgb_u8):
    """Doan nen trang hay den tu cac pixel o vien anh."""
    border = np.concatenate([rgb_u8[0], rgb_u8[-1], rgb_u8[:, 0], rgb_u8[:, -1]])
    return "white" if border.mean() >= 127.5 else "black"


class Remover:
    """Giu anh o dang so thuc va luu dem ket qua phan tich vung nen de keo thanh truot nhanh hon."""

    def __init__(self, img):
        rgba = np.asarray(img.convert("RGBA"))
        self.rgb = np.ascontiguousarray(rgba[..., :3])      # uint8
        self.a_in = np.ascontiguousarray(rgba[..., 3])      # uint8
        self.h, self.w = self.rgb.shape[:2]
        self._auto = None
        self._dist = {}
        self._regions = {}

    @property
    def size(self):
        return self.w, self.h

    def background(self, bg):
        if bg != "auto":
            return bg
        if self._auto is None:
            self._auto = detect_background(self.rgb)
        return self._auto

    def distance(self, bg):
        """Do khac mau nen cua tung pixel, 0 = dung mau nen, 1 = khac nhat."""
        if bg not in self._dist:
            raw = (255 - self.rgb.min(axis=-1)) if bg == "white" else self.rgb.max(axis=-1)
            self._dist = {bg: raw.astype(np.float32) / 255.0}
        return self._dist[bg]

    def regions(self, bg, threshold, close, bridge=0):
        """Chia cac pixel gan mau nen thanh cac vung lien thong. Tra ve (labels, areas, cham_mep)."""
        key = (bg, round(threshold, 4), close, bridge)
        if key not in self._regions:
            mask = self.distance(bg) <= threshold
            if close:
                # Mo hinh thai: cac khe nen hep hon 2*close px bi bo, nen khong ro vao trong thiet ke
                mask = ndimage.binary_erosion(mask, iterations=close, border_value=1)
                mask = ndimage.binary_dilation(mask, iterations=close)
            if bridge:
                # Dong hinh thai chi de xet lien thong: nen o hai ben mot net manh duoc coi la mot vung,
                # nhung chinh net manh van khong thuoc vung nen nen duoc giu lai.
                joined = ndimage.binary_closing(mask, iterations=bridge, border_value=1)
                labels, n = ndimage.label(joined)
                labels *= mask
            else:
                labels, n = ndimage.label(mask)
            areas = np.bincount(labels.ravel(), minlength=n + 1)
            border = np.zeros(n + 1, bool)
            edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
            border[np.unique(edge)] = True
            border[0] = False
            self._regions = {key: (labels, areas, border)}
        return self._regions[key]

    def _regions_for(self, o):
        return self.regions(self.background(o.bg), max(o.tolerance, CONNECT_MIN), CLOSE if o.close_gaps else 0, o.bridge)

    def region_at(self, o, x, y, radius=3):
        """Nhan cua vung nen gan diem (x, y) nhat (0 neu khong co)."""
        labels = self._regions_for(o)[0]
        if labels[y, x]:
            return int(labels[y, x])
        patch = labels[max(y - radius, 0): y + radius + 1, max(x - radius, 0): x + radius + 1]
        found = patch[patch > 0]
        return int(np.bincount(found).argmax()) if found.size else 0

    def decide(self, o, flips=(), ai=None):
        """Quyết định xóa/giữ từng vùng nền. Trả về (labels, remove) với remove[nhãn] = True nếu xóa."""
        labels, areas, border = self._regions_for(o)
        remove = border.copy()
        pocket = ~border
        pocket[0] = False
        if ai is not None:
            total = np.bincount(labels.ravel(), weights=ai.ravel(), minlength=len(areas))
            remove |= pocket & (total / np.maximum(areas, 1) < 0.5)
        parity = {}
        for x, y in flips:
            lab = self.region_at(o, x, y)
            # Nền ngoài không đổi được bằng điểm bấm: đổi tùy chọn có thể làm một khoảng kín nhập vào nền ngoài,
            # khi đó điểm bấm cũ sẽ vô tình giữ lại cả nền
            if lab and not border[lab]:
                parity[lab] = parity.get(lab, 0) ^ 1
        for lab, odd in parity.items():
            if odd:
                remove[lab] = ~remove[lab]
        remove[0] = False
        return labels, remove

    def render(self, o, flips=(), ai=None):
        """Tra ve anh RGBA nen trong suot.

        flips: cac diem (x, y) tren anh ma nguoi dung bam de doi xoa/giu vung nen do.
        ai: mask 0..1 (H, W) tu ai.foreground_mask, dung de quyet dinh cac khoang nen kin.
        """
        bg = self.background(o.bg)
        dist = self.distance(bg)
        tol = o.tolerance
        opaque = max(o.opaque, tol + 0.05)

        # gone: xoa han. ring: vien can tinh alpha. Phan con lai giu nguyen.
        if o.connected:
            labels, remove = self.decide(o, flips, ai)
            gone = remove[labels]
            zone = ndimage.binary_dilation(gone, iterations=GROW + (CLOSE if o.close_gaps else 0))
            # Chi pixel net ve (nhan 0) moi can tinh lai do trong suot; khoang nen duoc giu nam sat vung bi xoa
            # (cach mot net rat manh) phai giu nguyen, neu khong se thanh lo li ti tren vung trang
            ring = zone & (labels == 0)
        else:
            gone = dist <= tol
            ring = ~gone & (dist < opaque)

        alpha = np.clip((dist[ring] - tol) / (opaque - tol), 0.0, 1.0)
        c = self.rgb[ring].astype(np.float32) / 255.0
        safe = np.maximum(alpha, 1e-6)[:, None]
        fg = 1.0 - (1.0 - c) / safe if bg == "white" else c / safe
        fg = np.clip(fg, 0.0, 1.0)
        fg = self._clean_edges(fg, alpha, ring, gone)

        out = np.empty((self.h, self.w, 4), np.uint8)
        out[..., :3] = self.rgb
        out[..., 3] = self.a_in
        out[gone] = 0
        out[ring, :3] = (fg * 255 + 0.5).astype(np.uint8)
        out[ring, 3] = (alpha * self.a_in[ring] + 0.5).astype(np.uint8)
        if o.smooth > 0:
            self._feather(out, o.smooth)
        return Image.fromarray(out, "RGBA")

    @staticmethod
    def _feather(out, sigma):
        """Lam min rang cua bang quang mem o phia ngoai mep. Chi them do dac, khong bao gio lam
        nhat net hien co nen net manh (chu ky, day den) khong bi mong di."""
        alpha = out[..., 3].astype(np.float32) / 255.0
        soft = np.maximum(ndimage.gaussian_filter(alpha, sigma, truncate=3.0), alpha)
        radius = int(np.ceil(2 * sigma)) + 1
        solid = np.pad(alpha >= 0.98, radius)
        ys, xs = np.nonzero((soft > alpha + 0.004) & (alpha == 0))
        # Pixel moi them can mau: lay mau cua pixel dac gan nhat de quang khong bi vien trang/den
        colors = np.zeros((len(ys), 3), np.uint8)
        todo = np.arange(len(ys))
        for dy, dx in _offsets(radius):
            if not todo.size:
                break
            hit = solid[ys[todo] + dy + radius, xs[todo] + dx + radius]
            if hit.any():
                sel = todo[hit]
                colors[sel] = out[ys[sel] + dy, xs[sel] + dx, :3]
                todo = todo[~hit]
        found = np.ones(len(ys), bool)
        found[todo] = False
        soft[ys[~found], xs[~found]] = 0.0
        out[ys[found], xs[found], :3] = colors[found]
        out[..., 3] = (soft * 255 + 0.5).astype(np.uint8)

    def _clean_edges(self, fg, alpha, ring, gone):
        """Khu quang trang/den o vien: pixel ban trong suot lay mau cua pixel dac gan nhat."""
        semi = alpha < 0.98
        if not semi.any():
            return fg
        ys, xs = np.nonzero(ring)
        sy, sx = ys[semi], xs[semi]
        solid = ~gone
        solid[sy, sx] = False
        r = EDGE_REACH
        solid = np.pad(solid, r)
        colors = fg[semi]
        todo = np.ones(len(sy), bool)
        for dy, dx in _OFFSETS:
            hit = np.nonzero(todo & solid[sy + dy + r, sx + dx + r])[0]
            if hit.size:
                colors[hit] = self.rgb[sy[hit] + dy, sx[hit] + dx] / 255.0
                todo[hit] = False
        fg = fg.copy()
        fg[semi] = colors
        return fg


_offset_cache = {}


def _offsets(radius):
    """Cac do lech (dy, dx) trong ban kinh `radius`, sap tu gan den xa."""
    if radius not in _offset_cache:
        _offset_cache[radius] = sorted(
            ((dy, dx) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1)
             if 0 < dy * dy + dx * dx <= radius * radius),
            key=lambda p: p[0] * p[0] + p[1] * p[1],
        )
    return _offset_cache[radius]


_OFFSETS = _offsets(EDGE_REACH)


def remove_background(img, bg="auto", tolerance=0.06, opaque=0.8, connected=False,
                      close_gaps=False, ai=False, smooth=0.0, bridge=False):
    """Ham tien dung cho dong lenh: xu ly mot anh, tra ve RGBA."""
    mask = None
    if ai:
        import ai as ai_module
        mask = ai_module.foreground_mask(img)
    o = Options(bg, tolerance, opaque, connected, close_gaps, smooth, auto_bridge(img.size) if bridge else 0)
    return Remover(img).render(o, ai=mask)


def process(src, dst, **kw):
    remove_background(Image.open(src), **kw).save(dst, "PNG")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="Anh hoac thu muc anh")
    p.add_argument("output", nargs="?", help="Anh PNG hoac thu muc dau ra")
    p.add_argument("--bg", choices=["auto", "white", "black"], default="auto")
    p.add_argument("--tolerance", type=float, default=0.06, help="0 den 0.5, tang neu con vet nen")
    p.add_argument("--opaque", type=float, default=0.8, help="Muc khac nen de coi la dac hoan toan (giam neu thiet ke co mau nhat bi trong suot)")
    p.add_argument("--connected", action="store_true", help="Chi xoa nen noi voi mep anh, giu phan trang/den ben trong thiet ke")
    p.add_argument("--close-gaps", action="store_true", help="Bit khe ho nho trong net ve, tranh nen ro vao trong (can --connected)")
    p.add_argument("--bridge", action="store_true", help="Xuyen net manh: nen xuyen qua day den, net chu (do day tu dong theo kich thuoc anh)")
    p.add_argument("--smooth", type=float, default=0.0, help="Lam min vien (px), thu 1 den 2")
    p.add_argument("--ai", action="store_true", help="Dung AI de nhan dien khoang nen kin (can --connected, can onnxruntime)")
    a = p.parse_args(argv)
    kw = dict(bg=a.bg, tolerance=a.tolerance, opaque=a.opaque, connected=a.connected or a.ai or a.bridge,
              close_gaps=a.close_gaps, ai=a.ai, smooth=a.smooth, bridge=a.bridge)

    src = Path(a.input)
    if src.is_dir():
        out_dir = Path(a.output) if a.output else src / "tach_nen"
        out_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(f for f in src.iterdir() if f.suffix.lower() in EXTS)
        for f in files:
            process(f, out_dir / (f.stem + SUFFIX + ".png"), **kw)
            print("OK", f.name)
        print(f"Xong {len(files)} anh -> {out_dir}")
    else:
        dst = Path(a.output) if a.output else src.with_name(src.stem + SUFFIX + ".png")
        process(src, dst, **kw)
        print("Xong ->", dst)


if __name__ == "__main__":
    sys.exit(main())
