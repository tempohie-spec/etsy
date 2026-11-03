"""Con trỏ chuột tự vẽ cho chế độ vẽ và tẩy nét chắn.

Trên Windows, Tk nhận file con trỏ .cur qua cú pháp "@đường_dẫn". Nơi khác (hoặc nếu tạo file lỗi)
thì dùng con trỏ có sẵn của Tk.
"""
import math
import os
import struct
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

FALLBACK = {"draw": "pencil", "erase": "dotbox"}
SIZE = 32


def _bar(d, a, b, half, fill, scale):
    """Tứ giác dọc trục a -> b, nửa bề rộng `half`, viền tối."""
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    px, py = -(by - ay) / length * half, (bx - ax) / length * half
    pts = [(ax + px, ay + py), (bx + px, by + py), (bx - px, by - py), (ax - px, ay - py)]
    d.polygon([(x * scale, y * scale) for x, y in pts], fill=fill, outline=(25, 25, 25, 255), width=scale)


def pencil_image():
    """Bút chì nghiêng sang phải: đầu nhọn ở dưới bên trái, thân chạy lên trên bên phải. Trả về (ảnh, điểm nóng)."""
    s = 4
    im = Image.new("RGBA", (SIZE * s, SIZE * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    tip, wood, body_end, end = (2.0, 29.0), (8.5, 22.5), (24.0, 7.0), (28.5, 2.5)
    ux, uy = (wood[0] - tip[0]), (wood[1] - tip[1])
    half = 3.2
    n = math.hypot(ux, uy)
    px, py = -uy / n * half, ux / n * half
    cone = [tip, (wood[0] + px, wood[1] + py), (wood[0] - px, wood[1] - py)]
    d.polygon([(x * s, y * s) for x, y in cone], fill=(236, 205, 160, 255), outline=(25, 25, 25, 255), width=s)
    lead = [tip, (tip[0] + ux * 0.4 + px * 0.4, tip[1] + uy * 0.4 + py * 0.4),
            (tip[0] + ux * 0.4 - px * 0.4, tip[1] + uy * 0.4 - py * 0.4)]
    d.polygon([(x * s, y * s) for x, y in lead], fill=(30, 30, 30, 255))
    _bar(d, wood, body_end, half, (245, 190, 40, 255), s)        # thân vàng
    _bar(d, body_end, end, half, (240, 125, 155, 255), s)        # đuôi tẩy hồng
    return im.resize((SIZE, SIZE), Image.LANCZOS), (2, 29)


def eraser_image():
    """Cục tẩy nghiêng cùng hướng với bút chì; điểm nóng ở mép dưới bên trái."""
    s = 4
    im = Image.new("RGBA", (SIZE * s, SIZE * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    _bar(d, (5.0, 27.0), (13.0, 19.0), 5.5, (245, 245, 245, 255), s)    # đầu tẩy trắng
    _bar(d, (13.0, 19.0), (27.0, 5.0), 5.5, (240, 125, 155, 255), s)    # thân hồng
    return im.resize((SIZE, SIZE), Image.LANCZOS), (4, 27)


def write_cur(img, hotspot, path):
    """Ghi ảnh RGBA 32 x 32 thành file con trỏ .cur (ảnh DIB 32 bit có kênh alpha và mặt nạ AND)."""
    w, h = img.size
    px = np.asarray(img.convert("RGBA"))
    xor = np.ascontiguousarray(px[::-1][..., [2, 1, 0, 3]]).tobytes()   # BGRA, từ dưới lên
    row = ((w + 31) // 32) * 4
    mask = np.zeros((h, row), np.uint8)
    bits = np.packbits(px[::-1][..., 3] == 0, axis=1)                   # 1 = trong suốt
    mask[:, :bits.shape[1]] = bits
    dib = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + mask.size, 0, 0, 0, 0) + xor + mask.tobytes()
    head = struct.pack("<HHH", 0, 2, 1) + struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, hotspot[0], hotspot[1], len(dib), 22)
    with open(path, "wb") as f:
        f.write(head + dib)


def _short_path(path):
    """Đường dẫn dạng ngắn của Windows (không có dấu cách), vì Tk tách "@đường_dẫn" theo dấu cách."""
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(1024)
        if ctypes.windll.kernel32.GetShortPathNameW(path, buf, 1024):
            return buf.value
    except Exception:  # noqa: BLE001
        pass
    return path


def cursor_specs():
    """Chuỗi con trỏ cho Tk: {"draw": ..., "erase": ...}."""
    if sys.platform != "win32":
        return dict(FALLBACK)
    try:
        folder = os.path.join(tempfile.gettempdir(), "bg-remover-cursors")
        os.makedirs(folder, exist_ok=True)
        specs = {}
        for name, (img, hot) in (("draw", pencil_image()), ("erase", eraser_image())):
            path = os.path.join(folder, name + ".cur")
            write_cur(img, hot, path)
            path = _short_path(path).replace("\\", "/")
            specs[name] = "@" + path if " " not in path else FALLBACK[name]
        return specs
    except OSError:
        return dict(FALLBACK)
