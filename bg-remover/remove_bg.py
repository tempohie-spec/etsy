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
from PIL import Image, ImageDraw
from scipy import ndimage

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
SUFFIX = "_done"

GROW = 2          # px mo rong quanh vung nen de xu ly vien mo anti-alias
CLOSE = 2         # px khe ho duoc bit khi bat close_gaps
EDGE_REACH = 3    # px toi da de lay mau vien tu vung dac gan nhat
CONNECT_MIN = 0.08
JOIN_DARK = 0.45      # pixel khac nen hon muc nay coi la net ve dam khi noi net o cho giao
SPECK_AREA = 20       # khoang nen kin nho hon muc nay (px) nam trong khe hep duoc coi la vet sot, khong phai chi tiet


@dataclass
class Options:
    bg: str = "auto"            # auto | white | black
    tolerance: float = 0.06     # duoi muc nay coi la nen hoan toan
    opaque: float = 0.8         # tu muc nay tro len coi la dac hoan toan
    connected: bool = False     # chi xoa nen noi voi mep anh (giu phan trang/den ben trong)
    close_gaps: bool = False    # bit khe ho nho trong net ve de nen khong ro vao trong
    smooth: float = 0.0         # px; lam min vien bang quang mem phia ngoai mep (0 = tat)
    bridge: int = 0             # px: nen xuyen qua net manh hon 2*bridge px (day den, net chu); 0 = tat
    corners: bool = False       # xoa vet trang con sot trong khe hep o goc nhon giua hai net vien
    corner_light: float = 0.45  # do nhay goc nhon: pixel khac nen it hon muc nay trong khe hep duoc coi la vet sot
    join: int = 0               # px: to mau net vao khe hep hon 2*join px giua hai net dam sat nen (0 = tat)


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
        self.barrier = None       # net chan nguoi dung ve (mang bool H x W): nen khong duoc thong qua
        self._barrier_ver = 0

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
        # Doc/ghi bo dem qua bien cuc bo: luong giao dien va luong tinh nen co the goi cung luc
        cached = self._dist.get(bg)
        if cached is None:
            raw = (255 - self.rgb.min(axis=-1)) if bg == "white" else self.rgb.max(axis=-1)
            cached = raw.astype(np.float32) / 255.0
            self._dist = {bg: cached}
        return cached

    def set_barrier(self, mask):
        """Dat net chan (mang bool H x W, hoac None de bo)."""
        self.barrier = mask if mask is not None and mask.any() else None
        self._barrier_ver += 1
        self._regions = {}

    def regions(self, bg, threshold, close, bridge=0):
        """Chia cac pixel gan mau nen thanh cac vung lien thong. Tra ve (labels, areas, cham_mep)."""
        bar = self.barrier
        key = (bg, round(threshold, 4), close, bridge, self._barrier_ver)
        cached = self._regions.get(key)
        if cached is None:
            base = self.distance(bg) <= threshold
            mask = base
            if close:
                # Mo hinh thai: cac khe nen hep hon 2*close px bi bo, nen khong ro vao trong thiet ke
                mask = ndimage.binary_erosion(mask, iterations=close, border_value=1)
                mask = ndimage.binary_dilation(mask, iterations=close)
            if bar is not None:
                mask = mask & ~bar   # net chan cat dut nen
            if bridge:
                # Dong hinh thai chi de xet lien thong: nen o hai ben mot net manh duoc coi la mot vung,
                # nhung chinh net manh van khong thuoc vung nen nen duoc giu lai.
                joined = ndimage.binary_closing(mask, iterations=bridge, border_value=1)
                if bar is not None:
                    joined &= ~bar   # xuyen net manh cung khong duoc vuot qua net chan
                labels, n = ndimage.label(joined)
                labels *= mask
            else:
                labels, n = ndimage.label(mask)
            if bar is not None:
                _fill_barrier(labels, bar & base)
            areas = np.bincount(labels.ravel(), minlength=n + 1)
            border = np.zeros(n + 1, bool)
            edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
            border[np.unique(edge)] = True
            border[0] = False
            cached = (labels, areas, border)
            self._regions = {key: cached}
        return cached

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

    def decide(self, o, flips=()):
        """Quyết định xóa/giữ từng vùng nền. Trả về (labels, remove) với remove[nhãn] = True nếu xóa."""
        labels, _, border = self._regions_for(o)
        remove = border.copy()
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

    def render(self, o, flips=()):
        """Tra ve anh RGBA nen trong suot.

        flips: cac diem (x, y) tren anh ma nguoi dung bam de doi xoa/giu vung nen do.
        """
        bg = self.background(o.bg)
        dist = self.distance(bg)
        tol = o.tolerance
        opaque = max(o.opaque, tol + 0.05)

        # gone: xoa han. ring: vien can tinh alpha. Phan con lai giu nguyen.
        if o.connected:
            labels, remove = self.decide(o, flips)
            gone = remove[labels]
            # Dai vien lan tu vung nen da xoa nhung khong vuot qua net chan (mask: khong lan vao pixel net chan)
            free = None if self.barrier is None else ~self.barrier
            zone = ndimage.binary_dilation(gone, iterations=GROW + (CLOSE if o.close_gaps else 0), mask=free)
            # Chi pixel net ve (nhan 0) moi can tinh lai do trong suot; khoang nen duoc giu nam sat vung bi xoa
            # (cach mot net rat manh) phai giu nguyen, neu khong se thanh lo li ti tren vung trang
            ring = zone & (labels == 0)
            if o.corners:
                ring |= self._corner_specks(dist, labels, gone, ring, o)
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
        if o.join > 0:
            self._join_lines(out, dist, o.join)
        if o.smooth > 0:
            self._feather(out, o.smooth)
        return Image.fromarray(out, "RGBA")

    def _corner_specks(self, dist, labels, gone, ring, o):
        """Pixel sang nam trong khe hep (goc nhon giua hai net vien) va noi lien voi vung nen da xoa.

        Khe qua hep nen khong duoc tinh la nen, lai nam ngoai dai vien nen con lai vet trang. Chi lay phan
        hep (bien mat khi mo hinh thai) va noi voi nen da xoa, de khong dung vao phan to sang rong ben trong
        thiet ke (vi du phan trang cua dai ruy bang, von bi net vien ngan cach voi nen).
        """
        r = max(2, round(max(self.h, self.w) / 1000) + 1)
        free = None if self.barrier is None else ~self.barrier
        light = (dist < o.corner_light) | gone
        if free is not None:
            light &= free   # duong noi qua cac pixel sang khong duoc vuot qua net chan
        areas = self._regions_for(o)[1]
        # Pixel net ve sang, hoac manh nen bi khep lai rat nho; khoang nen kin lon hon (ruot gang tay...) khong dung toi
        cand = (labels == 0) | (~gone & (areas[labels] <= SPECK_AREA))
        # Vet sot luon nam sat nen da xoa (o dau khe); chi tiet sang ben trong hinh (diem highlight...) nam xa hon
        near = ndimage.binary_dilation(gone, iterations=2 * r, mask=free)
        thin = light & ~ndimage.binary_opening(light, iterations=r) & cand & ~ring & near
        if not thin.any():
            return thin
        comp, n = ndimage.label(thin, structure=np.ones((3, 3), bool))
        touch = np.unique(comp[ndimage.binary_dilation(gone | ring) & thin])
        keep = np.zeros(n + 1, bool)
        keep[touch] = True
        keep[0] = False
        return keep[comp]

    def _join_lines(self, out, dist, r):
        """Noi net o cho giao: khe rat hep giua hai net dam (mat di sau dong hinh thai ban kinh r) dang bi xoa
        hoac ban trong suot thi to bang mau net gan nhat, de hai net trong lien nhu anh goc thay vi bi dut."""
        dark = dist > JOIN_DARK
        gap = ndimage.binary_closing(dark, iterations=r, border_value=0) & ~dark & (out[..., 3] < 255)
        if not gap.any():
            return
        ys, xs = np.nonzero(gap)
        reach = r + 1
        solid = np.pad(dark, reach)
        colors = np.zeros((len(ys), 3), np.uint8)
        todo = np.arange(len(ys))
        for dy, dx in _offsets(reach):
            if not todo.size:
                break
            hit = solid[ys[todo] + dy + reach, xs[todo] + dx + reach]
            if hit.any():
                sel = todo[hit]
                colors[sel] = self.rgb[ys[sel] + dy, xs[sel] + dx]
                todo = todo[~hit]
        found = np.ones(len(ys), bool)
        found[todo] = False
        out[ys[found], xs[found], :3] = colors[found]
        out[ys[found], xs[found], 3] = self.a_in[ys[found], xs[found]]

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


def _fill_barrier(labels, fill):
    """Pixel nen nam duoi net chan theo vung nen gan nhat, de net chan khong de lai vet trang hay lo thung."""
    if not fill.any():
        return
    ys, xs = np.nonzero(fill)
    pad = 64
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, labels.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, labels.shape[1])
    crop = labels[y0:y1, x0:x1]   # chi tinh trong vung quanh net chan cho nhanh
    if not (crop > 0).any():
        return
    _, idx = ndimage.distance_transform_edt(crop == 0, return_indices=True)
    f = fill[y0:y1, x0:x1]
    crop[f] = crop[idx[0][f], idx[1][f]]


def barrier_mask(strokes, size, scale=1.0):
    """Ve cac net chan thanh mang bool kich thuoc `size` (W, H). Moi net: {"pts": [[x, y], ...], "w": do day px}."""
    if not strokes:
        return None
    img = Image.new("1", size, 0)
    d = ImageDraw.Draw(img)
    for st in strokes:
        w = max(1, round(st["w"] * scale))
        pts = [(x * scale, y * scale) for x, y in st["pts"]]
        if len(pts) > 1:
            d.line(pts, fill=1, width=w, joint="curve")
        r = w / 2
        for x, y in (pts[0], pts[-1]):   # dau tron o hai dau net
            d.ellipse((x - r, y - r, x + r, y + r), fill=1)
    return np.asarray(img, bool)


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
                      close_gaps=False, smooth=0.0, bridge=False, corners=False, corner_light=0.45, join=0):
    """Ham tien dung cho dong lenh: xu ly mot anh, tra ve RGBA."""
    o = Options(bg, tolerance, opaque, connected, close_gaps, smooth, auto_bridge(img.size) if bridge else 0, corners, corner_light, join)
    return Remover(img).render(o)


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
    p.add_argument("--corners", action="store_true", help="Xoa vet trang con sot trong khe hep o goc nhon giua hai net vien (can --connected)")
    p.add_argument("--corner-light", type=float, default=0.45, help="Do nhay goc nhon 0.2 den 0.65: cao hon thi xoa duoc vet nhat mau hon (can --corners)")
    p.add_argument("--join", type=int, default=0, help="Noi net o cho giao (px, 0 den 3): to mau net vao khe hep giua hai net sat nen; thu 2")
    p.add_argument("--smooth", type=float, default=0.0, help="Lam min vien (px), thu 1 den 2")
    a = p.parse_args(argv)
    kw = dict(bg=a.bg, tolerance=a.tolerance, opaque=a.opaque, connected=a.connected or a.bridge,
              close_gaps=a.close_gaps, smooth=a.smooth, bridge=a.bridge, corners=a.corners, corner_light=a.corner_light, join=a.join)

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
