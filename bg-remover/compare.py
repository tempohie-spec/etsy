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


def _base(size, bg, x0, x1):
    """Nền để đặt ảnh lên, phần x0..x1 của khung: ô caro nếu bg là None, ngược lại là màu đặc (r, g, b)."""
    if bg is None:
        return checker(size).crop((x0, 0, x1, size[1]))
    return Image.new("RGBA", (x1 - x0, size[1]), tuple(bg) + (255,))


def _layer(img, size, scale, ox, oy, bg, x0, x1):
    """Vẽ phần x0..x1 của khung. `scale` là số px khung trên mỗi px của `img`."""
    cw, ch = size
    out = _base(size, bg, x0, x1)
    iw, ih = img.size
    dx0, dy0 = max(x0, int(np.ceil(ox))), max(0, int(np.ceil(oy)))
    dx1, dy1 = min(x1, int(np.floor(ox + iw * scale))), min(ch, int(np.floor(oy + ih * scale)))
    if dx1 <= dx0 or dy1 <= dy0:
        return out
    box = ((dx0 - ox) / scale, (dy0 - oy) / scale, (dx1 - ox) / scale, (dy1 - oy) / scale)
    mode = Image.NEAREST if scale >= 3 else Image.BILINEAR
    part = img.resize((dx1 - dx0, dy1 - dy0), mode, box=box, reducing_gap=2.0 if scale < 1 else None)
    out.alpha_composite(part, (dx0 - x0, dy0))
    return out


def render_view(before, after, size, scale, ox, oy, div, bg=None):
    """Ảnh trước ở bên trái thanh chia `div`, ảnh sau ở bên phải. Cả hai là RGBA.

    `after` có thể nhỏ hơn `before` (bản xem nhanh): nó được căn theo cùng khung mà không cần phóng to trước.
    bg: None để hiện ô caro, hoặc màu (r, g, b) để xem ảnh đã tách trên nền đó.
    """
    cw, ch = size
    d = int(min(max(div, 0), cw))
    out = Image.new("RGBA", size)
    if d > 0:
        out.paste(_layer(before, size, scale, ox, oy, bg, 0, d), (0, 0))
    if d < cw:
        out.paste(_layer(after, size, scale * before.width / after.width, ox, oy, bg, d, cw), (d, 0))
    return out.convert("RGB")
