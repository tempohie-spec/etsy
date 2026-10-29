"""Ve khung xem so sanh truoc/sau (khong phu thuoc tkinter de de kiem thu)."""
import numpy as np
from PIL import Image

_cache = {}


def checker(size, cell=12):
    if size not in _cache:
        w, h = size
        yy, xx = np.mgrid[0:h, 0:w]
        v = np.where(((xx // cell + yy // cell) % 2) == 0, 235, 200).astype(np.uint8)
        rgba = np.stack([v, v, v, np.full_like(v, 255)], axis=-1)
        _cache.clear()
        _cache[size] = Image.fromarray(rgba, "RGBA")
    return _cache[size]


def fit_view(img_size, canvas_size):
    """Tra ve (scale, ox, oy) de anh vua khung va nam giua."""
    (iw, ih), (cw, ch) = img_size, canvas_size
    scale = min(cw / iw, ch / ih)
    return scale, (cw - iw * scale) / 2, (ch - ih * scale) / 2


def _layer(img, size, scale, ox, oy):
    cw, ch = size
    out = checker(size).copy()
    iw, ih = img.size
    x0, y0 = max(0, int(np.ceil(ox))), max(0, int(np.ceil(oy)))
    x1, y1 = min(cw, int(np.floor(ox + iw * scale))), min(ch, int(np.floor(oy + ih * scale)))
    if x1 <= x0 or y1 <= y0:
        return out
    box = ((x0 - ox) / scale, (y0 - oy) / scale, (x1 - ox) / scale, (y1 - oy) / scale)
    mode = Image.NEAREST if scale >= 3 else Image.BILINEAR
    part = img.resize((x1 - x0, y1 - y0), mode, box=box, reducing_gap=2.0 if scale < 1 else None)
    out.alpha_composite(part, (x0, y0))
    return out


def render_view(before, after, size, scale, ox, oy, div):
    """Anh truoc o ben trai thanh chia `div`, anh sau o ben phai. Ca hai la RGBA."""
    right = _layer(after, size, scale, ox, oy)
    left = _layer(before, size, scale, ox, oy)
    right.paste(left.crop((0, 0, int(div), size[1])), (0, 0))
    return right.convert("RGB")
