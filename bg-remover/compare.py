"""Vẽ khung xem so sánh trước/sau (không phụ thuộc tkinter để dễ kiểm thử)."""
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
    """Trả về (scale, ox, oy) để ảnh vừa khung và nằm giữa."""
    (iw, ih), (cw, ch) = img_size, canvas_size
    scale = min(cw / iw, ch / ih)
    return scale, (cw - iw * scale) / 2, (ch - ih * scale) / 2


def _base(size, bg):
    """Nền để đặt ảnh lên: ô caro nếu bg là None, ngược lại là màu đặc (r, g, b)."""
    if bg is None:
        return checker(size).copy()
    return Image.new("RGBA", size, tuple(bg) + (255,))


def _layer(img, size, scale, ox, oy, bg):
    cw, ch = size
    out = _base(size, bg)
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


def render_view(before, after, size, scale, ox, oy, div, bg=None):
    """Ảnh trước ở bên trái thanh chia `div`, ảnh sau ở bên phải. Cả hai là RGBA.

    bg: None để hiện ô caro, hoặc màu (r, g, b) để xem ảnh đã tách trên nền đó.
    """
    right = _layer(after, size, scale, ox, oy, bg)
    left = _layer(before, size, scale, ox, oy, bg)
    right.paste(left.crop((0, 0, int(div), size[1])), (0, 0))
    return right.convert("RGB")
