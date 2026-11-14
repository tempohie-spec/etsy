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
JOIN_DARK = 0.45      # pixel khac nen hon muc nay coi la net ve dam khi to bu khe gan khoang nen duoc giu
INC_MAX_REGIONS = 12  # bam toi da bay nhieu vung moi lan thi tinh tung phan; nhieu hon thi tinh lai ca anh
INC_MAX_SHARE = 0.45  # manh tinh lai chiem qua ty le nay cua anh thi tinh lai ca anh
POCKET_LIGHT = 0.2     # khoang kin duoc xoa lan them qua pixel khac nen it hon muc nay (nen nga xam sat net vien)
POCKET_GREY = 26      # ... va chi qua pixel gan nhu khong mau: chenh lech giua cac kenh mau toi da muc nay (0-255)
FAR = 6               # khe hep co the keo dai toi FAR * r px tinh tu nen da xoa (r ti le voi kich thuoc anh)
FLANK_DARK = 0.55     # hai ben khe deu co net dam hon muc nay thi pixel o giua duoc so voi net do
FLANK_REL = 0.65      # pixel giua hai net duoc coi la vet sot neu do dam chi bang ty le nay cua net yeu hon
FLANK_LIGHT = 0.6     # tran khi tim khe hep: pixel khac nen it hon muc nay moi co the thuoc khe


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
        self._wide = {}           # bo dem: phan sang rong (khong phai khe hep), khong phu thuoc vung dang xoa
        self._state = None        # bo dem: (tuy chon, diem bam, vung xoa, anh truoc buoc lam min vien) cua lan tinh gan nhat
        self._final = None        # bo dem: anh da lam min vien tuong ung voi _state
        self._objs = None         # bo dem: (labels, find_objects(labels)) de tinh khung bao cua tung vung
        self._soft = None         # bo dem: cac mang nen nga xam lien nhau (xem _soft_info)
        self._ref = max(self.h, self.w)   # kich thuoc tham chieu de doi cac don vi theo pixel (cua ca anh, ke ca khi tinh tren mot manh)
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
        self._state = self._final = self._objs = self._soft = None

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

    def prepare_clicks(self, o):
        """Tinh san cac du lieu can de bam chon vung nhanh (goi o luong nen sau khi co ket qua day du)."""
        if not o.connected:
            return
        labels = self._regions_for(o)[0]
        if self._objs is None or self._objs[0] is not labels:
            self._objs = (labels, ndimage.find_objects(labels))
        self._soft_info(o)

    def release(self):
        """Bo cac bo dem lon (ket qua trung gian) khi khong dung toi nua de do ton bo nho."""
        self._state = self._final = self._objs = self._soft = None
        self._wide = {}

    def _unit(self):
        """Don vi do theo pixel, ti le voi kich thuoc cua ca anh (khong doi khi chi tinh tren mot manh)."""
        return max(2, round(self._ref / 1000) + 1)

    def render(self, o, flips=()):
        """Tra ve anh RGBA nen trong suot.

        flips: cac diem (x, y) tren anh ma nguoi dung bam de doi xoa/giu vung nen do.

        Ket qua truoc buoc lam min vien duoc luu lai: chi doi "Lam min vien" thi khong tinh lai tu dau, va bam them
        mot vung nen thi chi tinh lai quanh vung do (ket qua giong het tinh lai toan anh).
        """
        nof = (o.bg, o.tolerance, o.opaque, o.connected, o.close_gaps, o.bridge, o.corners, o.corner_light, self._barrier_ver)
        flips = tuple((int(x), int(y)) for x, y in flips)
        labels = remove = border = None
        soft = None
        if o.connected:
            labels, remove = self.decide(o, flips)
            border = self._regions_for(o)[2]
        st = self._state
        # Mang nen xam chi can khi co khoang nen kin dang bi xoa (luc do moi phai tim va luu chung)
        if o.connected and ((remove & ~border).any() or (st is not None and st[0] == nof and st[2] is not None and (st[2] & ~border).any())):
            soft = self._soft_info(o)
        out = prev = box = None
        if st is not None and st[0] == nof:
            if st[1] == flips:
                out = st[3]
            elif o.connected:
                inc = self._incremental(o, st, labels, remove, border, soft)
                if inc is not None:
                    out, box = inc
                    prev = st[3]
        if out is None:
            out = self._compose(o, labels, remove, border, None if soft is None else (soft[0], self._flood_flags(soft, remove, border)))
        self._state = (nof, flips, remove, out)

        if o.smooth <= 0:
            arr = out
        else:
            fin = self._final
            if fin is not None and fin[0] == o.smooth and fin[1] is out:
                arr = fin[2]
            elif fin is not None and fin[0] == o.smooth and box is not None and fin[1] is prev:
                arr = fin[2].copy()
                H, W = out.shape[:2]
                y0, y1, x0, x1 = box
                py0, py1, px0, px1 = max(y0 - 8, 0), min(y1 + 8, H), max(x0 - 8, 0), min(x1 + 8, W)   # vung doi sau lam min
                wy0, wy1, wx0, wx1 = max(y0 - 16, 0), min(y1 + 16, H), max(x0 - 16, 0), min(x1 + 16, W)
                part = out[wy0:wy1, wx0:wx1].copy()
                self._feather(part, o.smooth)
                arr[py0:py1, px0:px1] = part[py0 - wy0:py1 - wy0, px0 - wx0:px1 - wx0]
            else:
                arr = out.copy()
                self._feather(arr, o.smooth)
            self._final = (o.smooth, out, arr)
        return Image.fromarray(arr, "RGBA")

    def _incremental(self, o, st, labels, remove, border, soft):
        """Chi tinh lai quanh cac vung nen vua doi xoa/giu. Tra ve (anh moi, khung bao vung doi) hoac None neu
        phai tinh lai toan anh (doi nhieu vung, vung qua lon, hoac anh huong lan toi mep manh tinh)."""
        remove_old, out_old = st[2], st[3]
        changed = np.nonzero(remove != remove_old)[0]
        if not len(changed):
            return out_old, None
        flag_new, flag_old = self._flood_flags(soft, remove, border), self._flood_flags(soft, remove_old, border)
        flooded = np.nonzero(flag_new != flag_old)[0]     # mang nen xam doi tu "giu" sang "xoa" hoac nguoc lai
        if len(changed) > INC_MAX_REGIONS:
            return None
        objs = self._objs
        if objs is None or objs[0] is not labels:
            objs = self._objs = (labels, ndimage.find_objects(labels))
        slices = [objs[1][int(i) - 1] for i in changed if int(i) >= 1 and objs[1][int(i) - 1] is not None]
        slices += [soft[2][int(i) - 1] for i in flooded if int(i) >= 1 and soft[2][int(i) - 1] is not None]
        if not slices:
            return None
        y0 = min(sl[0].start for sl in slices); y1 = max(sl[0].stop for sl in slices)
        x0 = min(sl[1].start for sl in slices); x1 = max(sl[1].stop for sl in slices)
        H, W = labels.shape
        r = self._unit()
        margin = 20 * r + 40
        for _ in range(2):
            wy0, wy1, wx0, wx1 = max(y0 - margin, 0), min(y1 + margin, H), max(x0 - margin, 0), min(x1 + margin, W)
            if (wy1 - wy0) * (wx1 - wx0) > INC_MAX_SHARE * H * W:
                return None
            win = (slice(wy0, wy1), slice(wx0, wx1))
            sub = self._crop(win, o)
            lab = labels[win]
            sl_lab = soft[0][win]
            new = sub._compose(o, lab, remove, border, (sl_lab, flag_new))
            old = sub._compose(o, lab, remove_old, border, (sl_lab, flag_old))
            diff = (new != old).any(axis=2)
            if not diff.any():
                return out_old, None
            # Hai manh tinh co chung sai lech o sat mep manh, nen sai lech sat mep (khong phai mep anh that) la dau hieu
            # anh huong con lan ra ngoai manh: mo rong manh, neu van vay thi tinh lai toan anh
            band = 8 * r + 16
            bad = ((wy0 > 0 and diff[:band].any()) or (wy1 < H and diff[-band:].any()) or
                   (wx0 > 0 and diff[:, :band].any()) or (wx1 < W and diff[:, -band:].any()))
            if not bad:
                break
            margin *= 3
        else:
            return None
        out = out_old.copy()
        view = out[win]
        view[diff] = new[diff]
        ys, xs = np.nonzero(diff)
        return out, (wy0 + int(ys.min()), wy0 + int(ys.max()) + 1, wx0 + int(xs.min()), wx0 + int(xs.max()) + 1)

    def _crop(self, win, o):
        """Bo tach nen chi tren mot manh cua anh (dung chung du lieu, khong sao chep)."""
        sub = Remover.__new__(Remover)
        sub.rgb, sub.a_in = self.rgb[win], self.a_in[win]
        sub.h, sub.w = sub.rgb.shape[:2]
        bg = self.background(o.bg)
        sub._auto = self._auto
        sub._dist = {bg: self.distance(bg)[win]}
        sub._regions, sub._wide, sub._state, sub._final, sub._objs, sub._soft = {}, {}, None, None, None, None
        sub.barrier = None if self.barrier is None else self.barrier[win]
        sub._barrier_ver = self._barrier_ver
        sub._ref = self._ref
        return sub

    def _compose(self, o, labels, remove, border, soft):
        """Ket qua RGBA (mang uint8) truoc buoc lam min vien. labels/remove/border: xem decide(); soft: xem _fill_pockets."""
        bg = self.background(o.bg)
        dist = self.distance(bg)
        tol = o.tolerance
        opaque = max(o.opaque, tol + 0.05)

        # gone: xoa han. ring: vien can tinh alpha. Phan con lai giu nguyen.
        if o.connected:
            gone = remove[labels]
            gone = self._fill_pockets(gone, soft)
            # Dai vien lan tu vung nen da xoa nhung khong vuot qua net chan (mask: khong lan vao pixel net chan)
            free = None if self.barrier is None else ~self.barrier
            # near_gone(n): pixel cach vung da xoa toi da n buoc. Khong co net chan thi tinh mot lan khoang cach
            # toi vung da xoa roi so nguong (nhanh hon nhieu so voi gian no lap lai, ket qua y het)
            if free is None:
                gd = _steps_to(gone)
                near_gone = lambda n: gd <= n
            else:
                near_gone = lambda n: ndimage.binary_dilation(gone, iterations=n, mask=free)
            zone = near_gone(GROW + (CLOSE if o.close_gaps else 0))
            # Chi pixel net ve (nhan 0) moi can tinh lai do trong suot; khoang nen duoc giu nam sat vung bi xoa
            # (cach mot net rat manh) phai giu nguyen, neu khong se thanh lo li ti tren vung trang
            ring = zone & (labels == 0)
            fill = None
            if o.corners:
                specks, fill = self._corner_specks(dist, labels, gone, ring, o, near_gone)
                gone = gone | specks   # vet sot trong khe goc nhon xoa han (khong tinh do trong suot theo do trang)
                ring &= ~specks
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
        if o.connected and fill is not None and fill.any():
            self._paint_dark(out, fill, dist > JOIN_DARK, self._unit() * 2)
        return out

    def _soft_info(self, o):
        """Cac mang nen nga xam: pixel chua phai nen ma rat nhat va gan nhu khong mau (bong do, chuyen mau sat net).
        Tra ve (nhan mang theo 4 huong, so mang, danh sach khung bao, cac cap (mang, vung nen) ke nhau).
        Chi phu thuoc tuy chon, khong phu thuoc vung nao dang xoa hay giu nen duoc luu dung chung."""
        bg = self.background(o.bg)
        key = (bg, round(max(o.tolerance, CONNECT_MIN), 4), CLOSE if o.close_gaps else 0, o.bridge, self._barrier_ver)
        cached = self._soft
        if cached is not None and cached[0] == key:
            return cached[1]
        labels = self._regions_for(o)[0]
        soft = (labels == 0) & (self.distance(bg) <= POCKET_LIGHT)
        if soft.any():
            soft &= (self.rgb.max(axis=-1) - self.rgb.min(axis=-1)) <= POCKET_GREY
        if self.barrier is not None:
            soft &= ~self.barrier
        # Mang rong, dai hep 1-2 px sat net la vien khu rang cua cua net (de buoc tinh do trong suot xu ly)
        soft_lab, n = ndimage.label(soft)
        pairs = np.zeros((0, 2), np.int64)
        if n:
            nl = int(labels.max()) + 1
            ys, xs = np.nonzero(soft)             # chi xet pixel cua cac mang (it hon nhieu so voi ca anh)
            lab_p = np.pad(labels, 1)
            codes = []
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nb = lab_p[ys + 1 + dy, xs + 1 + dx]
                m = nb > 0
                codes.append(np.unique(soft_lab[ys[m], xs[m]].astype(np.int64) * nl + nb[m]))
            code = np.unique(np.concatenate(codes))
            pairs = np.stack([code // nl, code % nl], axis=1)
        info = (soft_lab, n, ndimage.find_objects(soft_lab) if n else [], pairs)
        self._soft = (key, info)
        return info

    @staticmethod
    def _flood_flags(soft, remove, border):
        """flag[c] = True neu mang nen xam c ke voi mot khoang nen kin dang bi xoa (khi do mang cung bi xoa)."""
        flag = np.zeros(soft[1] + 1, bool)
        pairs = soft[3]
        if len(pairs):
            sel = (remove & ~border)[pairs[:, 1]]
            flag[pairs[sel, 0]] = True
        return flag

    def _fill_pockets(self, gone, soft):
        """Khoang nen kin duoc chon xoa thi xoa tron toi net vien: phan nen nga xam (bong do, chuyen mau gan net)
        khong du gan mau nen de thuoc khoang do nhung van lien voi no. Chi lan qua pixel nhat va gan nhu khong
        mau (xam), khong lan vao mang mau nhat (hong, xanh nhat) va khong ap dung cho nen ngoai."""
        if soft is None:
            return gone
        soft_lab, flag = soft
        if not flag.any():
            return gone
        extra = flag[soft_lab]
        return gone | ndimage.binary_opening(extra, iterations=2)

    def _wide_light(self, bg, loose, r):
        """Phan sang rong (con lai sau mo hinh thai ban kinh r) cua cac pixel gan mau nen. Vung da xoa luon nam
        trong cac pixel gan mau nen, nen ket qua khong phu thuoc vung nao dang xoa hay giu: luu lai dung chung."""
        key = (bg, loose, r, self._barrier_ver)
        cached = self._wide.get(key)
        if cached is None:
            light = self.distance(bg) < loose
            if self.barrier is not None:
                light &= ~self.barrier
                wide = ndimage.binary_opening(light, iterations=r)
            else:
                # Co r lan = cach pixel toi (hoac mep anh) hon r buoc; gian r lan = cach phan con lai toi da r buoc
                core = ndimage.distance_transform_cdt(np.pad(light, 1), metric="taxicab")[1:-1, 1:-1] > r
                wide = _steps_to(core) <= r
            cached = (light, wide)
            self._wide = {key: cached}
        return cached

    def _corner_specks(self, dist, labels, gone, ring, o, near_gone):
        """Pixel sang nam trong khe hep (goc nhon giua hai net vien) va noi lien voi vung nen da xoa.

        Khe qua hep nen khong duoc tinh la nen, lai nam ngoai dai vien nen con lai vet trang. Chi lay phan
        hep (bien mat khi mo hinh thai) va noi voi nen da xoa, de khong dung vao phan to sang rong ben trong
        thiet ke (vi du phan trang cua dai ruy bang, von bi net vien ngan cach voi nen).

        Cang vao sau goc nhon mau cang bi tron voi mau net nen khong con trang han; vi vay pixel nam giua hai
        net dam (hai ben deu co net dam) duoc so voi chinh hai net do: nhat hon han net thi coi la vet sot.
        Tra ve (specks, fill): specks bi xoa han, fill la phan khe gan khoang nen duoc giu thi to bang mau net.
        """
        r = self._unit()
        free = None if self.barrier is None else ~self.barrier
        loose = max(o.corner_light, FLANK_LIGHT)
        # Pixel sang (gan mau nen, khong nam tren net chan) va phan rong cua chung; vung da xoa nam ca trong do
        light, wide = self._wide_light(self.background(o.bg), loose, r)
        # Chi xet pixel net ve sang (khong thuoc vung nen nao); vung nen duoc giu lai thi khong bao gio dung toi
        cand = labels == 0
        thin = light & ~wide & cand & near_gone(FAR * r) & ~gone
        empty = np.zeros_like(thin)
        if not thin.any():
            return empty, empty
        ys, xs = np.nonzero(thin)
        d = dist[ys, xs]
        flank = _flank(dist, ys, xs, 3 * r + 2)
        flanked = flank >= FLANK_DARK
        # Chi pixel o dau khe (sat nen da xoa) moi duoc xoa theo do nhay tuyet doi; chi tiet sang ben trong
        # hinh (diem highlight...) nam xa hon, chi xoa khi nam giua hai net dam
        near = near_gone(2 * r)[ys, xs]
        ok = flanked & ((d < o.corner_light) | (d < FLANK_REL * flank))
        ok |= near & ~ring[ys, xs] & (d < o.corner_light)
        thin = empty.copy()   # (khong dung chung bo nho voi empty: empty con duoc tra ve lam mask rong)
        thin[ys[ok], xs[ok]] = True
        if not thin.any():
            return thin, empty
        comp, n = ndimage.label(thin, structure=np.ones((3, 3), bool))
        # Thanh phan nao cham (4 huong) vao vung da xoa hoac dai vien: xet ngay tai cac pixel cua khe
        ys, xs = np.nonzero(thin)
        edge = np.pad(gone | ring, 1)
        hit = edge[ys + 1, xs + 1] | edge[ys, xs + 1] | edge[ys + 2, xs + 1] | edge[ys + 1, xs] | edge[ys + 1, xs + 2]
        touch = np.unique(comp[ys[hit], xs[hit]])
        keep = np.zeros(n + 1, bool)
        keep[touch] = True
        keep[0] = False
        specks = keep[comp]
        fill = empty.copy()
        # Khe hep thong tu nen da xoa vao mot khoang trang duoc giu ben trong (cho hai net gan cham nhau, vi du
        # vien nguc va vien chan thu): xoa se thanh lo thung vao phan trang. Phan khe nam gan khoang trang do
        # (do theo duong di qua pixel sang) khong xoa ma to bang mau net ben canh, de hai net lien nhau.
        kept_inside = (labels > 0) & ~gone
        if kept_inside.any() and specks.any():
            guard = ndimage.binary_dilation(kept_inside, iterations=2 * r, mask=light & ~gone) & specks
            if guard.any():
                specks &= ~guard
                dark = dist > JOIN_DARK
                # Chi to phan nam giua hai net dam va sat phia nen da xoa (cua khe), khong lan vao long khoang trang
                between = ndimage.binary_closing(dark, iterations=r, border_value=0) & ~dark
                mouth = ndimage.binary_dilation(gone, iterations=r, mask=light)
                fill = guard & between & mouth
        return specks, fill

    def _paint_dark(self, out, mask, dark, reach):
        """To cac pixel trong mask bang mau pixel net dam gan nhat (trong ban kinh reach), dac hoan toan."""
        if not mask.any():
            return
        ys, xs = np.nonzero(mask)
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


def _flank(dist, ys, xs, reach):
    """Voi moi pixel: do dam cua net yeu hon trong hai ben doi dien (theo huong tot nhat trong 4 huong),
    tim trong ban kinh `reach`. Lon nghia la pixel nam giua hai net dam."""
    pad = np.pad(dist, reach)
    best = np.zeros(len(ys), np.float32)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        a = np.zeros(len(ys), np.float32)
        b = np.zeros(len(ys), np.float32)
        for k in range(1, reach + 1):
            np.maximum(a, pad[ys + reach + dy * k, xs + reach + dx * k], out=a)
            np.maximum(b, pad[ys + reach - dy * k, xs + reach - dx * k], out=b)
        np.maximum(best, np.minimum(a, b), out=best)
    return best


def _steps_to(mask):
    """So buoc (len/xuong/trai/phai) tu moi pixel toi pixel True gan nhat cua mask; rat lon neu mask rong."""
    if not mask.any():
        return np.full(mask.shape, 1 << 30, np.int32)
    return ndimage.distance_transform_cdt(~mask, metric="taxicab")


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
                      close_gaps=False, smooth=0.0, bridge=False, corners=False, corner_light=0.45):
    """Ham tien dung cho dong lenh: xu ly mot anh, tra ve RGBA."""
    o = Options(bg, tolerance, opaque, connected, close_gaps, smooth, auto_bridge(img.size) if bridge else 0, corners, corner_light)
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
    p.add_argument("--smooth", type=float, default=0.0, help="Lam min vien (px), thu 1 den 2")
    a = p.parse_args(argv)
    kw = dict(bg=a.bg, tolerance=a.tolerance, opaque=a.opaque, connected=a.connected or a.bridge,
              close_gaps=a.close_gaps, smooth=a.smooth, bridge=a.bridge, corners=a.corners, corner_light=a.corner_light)

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
