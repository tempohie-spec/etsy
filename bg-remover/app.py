"""Ứng dụng máy tính tách nền ảnh thiết kế 2D (nền trắng hoặc đen). Chạy: python app.py"""
import json
import os
import threading
import tkinter as tk
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from tkinter import font as tkfont

import numpy as np
from PIL import Image, ImageTk

from compare import fit_view, render_view
from cursors import FALLBACK as FALLBACK_CURSORS, cursor_specs
from learn import MIN_PER_CLASS, MIN_SAMPLES, Learner, region_features, suggest_points
from remove_bg import EXTS, SUFFIX, Options, Remover, auto_bridge, barrier_mask
from settings import Store
from version import VERSION

ZOOM_STEP = 1.2
MAX_ZOOM = 64.0
GRAB = 14            # px quanh thanh chia để kéo
CLICK_MAX = 4        # di chuyển tối đa (px) để tính là bấm chứ không phải kéo
PREVIEW_SIDE = 800   # cạnh dài (px) của bản thu nhỏ dùng để xem nhanh khi kéo thanh trượt
POLL_MS = 15         # chu kỳ kiểm tra kết quả xem nhanh từ luồng nền
FULL_DELAY = 350     # ms yên lặng trước khi tính lại đầy đủ
HISTORY_MAX = 100
STROKE_COLOR = "#ff2fd0"   # màu hiển thị nét chắn
PANEL_WIDTH = 340    # bề rộng bảng tùy chọn bên phải
DESC_WRAP = PANEL_WIDTH - 40
CACHE_SIZE = 4       # số ảnh vừa mở được giữ sẵn trong bộ nhớ để chuyển lại gần như tức thì
BATCH_WORKERS = max(1, min(4, (os.cpu_count() or 2) - 1))   # luồng xử lý cả lô, chừa một nhân cho giao diện

PREVIEW_BGS = {
    "Ô caro (trong suốt)": None,
    "Đen": (0, 0, 0),
    "Trắng": (255, 255, 255),
    "Xanh lá": (0, 170, 70),
    "Xanh dương": (30, 80, 220),
    "Đỏ": (220, 30, 30),
    "Xám đậm": (64, 64, 64),
    "Xám nhạt": (200, 200, 200),
}


def _stroke_distance(stroke, x, y):
    """Khoảng cách ngắn nhất từ điểm (x, y) tới đường gấp khúc của một nét chắn."""
    pts = np.asarray(stroke["pts"], float)
    if len(pts) == 1:
        return float(np.hypot(*(pts[0] - (x, y))))
    a, b = pts[:-1], pts[1:]
    ab = b - a
    t = np.clip(((x - a[:, 0]) * ab[:, 0] + (y - a[:, 1]) * ab[:, 1]) / np.maximum((ab ** 2).sum(1), 1e-9), 0, 1)
    proj = a + ab * t[:, None]
    return float(np.hypot(proj[:, 0] - x, proj[:, 1] - y).min())


class PreviewWorker(threading.Thread):
    """Tính bản xem nhanh ở luồng riêng để giao diện không bị chặn. Chỉ giữ yêu cầu mới nhất."""

    def __init__(self):
        super().__init__(daemon=True)
        self._cv = threading.Condition()
        self._request = None
        self._result = None
        self._working = False
        self._closing = False
        self.start()

    def submit(self, fn):
        with self._cv:
            self._request = fn
            self._cv.notify()

    @property
    def busy(self):
        with self._cv:
            return self._request is not None or self._working

    def take(self):
        with self._cv:
            result, self._result = self._result, None
            return result

    def close(self):
        with self._cv:
            self._closing = True
            self._cv.notify()

    def run(self):
        while True:
            with self._cv:
                while self._request is None and not self._closing:
                    self._cv.wait()
                if self._closing:
                    return
                fn, self._request, self._working = self._request, None, True
            try:
                out = fn()
            except Exception as e:  # noqa: BLE001 - báo lỗi về giao diện thay vì làm sập luồng
                out = ("error", e)
            with self._cv:
                self._result, self._working = out, False


class ScrollPanel(ttk.Frame):
    """Khung cuộn dọc cho bảng tùy chọn; con lăn chuột cuộn khi con trỏ nằm trên bảng."""

    def __init__(self, master, width):
        super().__init__(master)
        bg = ttk.Style(self).lookup("TFrame", "background") or None
        self.canvas = tk.Canvas(self, width=width, highlightthickness=0, bg=bg)
        bar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.inner = ttk.Frame(self.canvas, padding=(4, 0, 8, 8))
        win = self.canvas.create_window(0, 0, window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(win, width=e.width))
        self.canvas.configure(yscrollcommand=bar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        bar.pack(side="right", fill="y")
        # Một bộ xử lý chung: chỉ cuộn khi con trỏ nằm trên bảng (kể cả trên nút, ô chọn bên trong).
        # Không dùng Enter/Leave vì Tk báo "rời đi" khi con trỏ di vào ô con.
        self.bind_all("<MouseWheel>", lambda e: self._scroll(e, -1 if e.delta > 0 else 1), add="+")
        self.bind_all("<Button-4>", lambda e: self._scroll(e, -1), add="+")
        self.bind_all("<Button-5>", lambda e: self._scroll(e, 1), add="+")

    def _scroll(self, e, units):
        w = self.winfo_containing(e.x_root, e.y_root)
        while w is not None:
            if w is self:
                self.canvas.yview_scroll(units, "units")
                return
            w = w.master


class Tooltip:
    """Chú thích hiện khi rê chuột vào một ô điều khiển và dừng lại một lúc."""
    DELAY = 450   # ms

    def __init__(self, widget, text):
        self.widget, self.text = widget, text
        self._job = self._win = None
        widget.bind("<Enter>", self._schedule, add="+")
        for seq in ("<Leave>", "<ButtonPress>", "<Destroy>"):
            widget.bind(seq, self.hide, add="+")

    def _schedule(self, _event=None):
        self.hide()
        self._job = self.widget.after(self.DELAY, self.show)

    def show(self):
        self._job = None
        if self._win is not None or not self.widget.winfo_exists():
            return
        self._win = win = tk.Toplevel(self.widget)
        win.wm_overrideredirect(True)
        try:
            win.attributes("-topmost", True)
        except tk.TclError:
            pass
        tk.Label(win, text=self.text, justify="left", wraplength=320, background="#ffffe1", foreground="#000000",
                 relief="solid", borderwidth=1, padx=6, pady=4).pack()
        win.update_idletasks()
        # Đặt ngay dưới con trỏ, không tràn ra ngoài màn hình
        x = min(self.widget.winfo_pointerx() + 14, win.winfo_screenwidth() - win.winfo_reqwidth() - 4)
        y = self.widget.winfo_pointery() + 18
        if y + win.winfo_reqheight() > win.winfo_screenheight() - 4:
            y = self.widget.winfo_pointery() - win.winfo_reqheight() - 10
        win.wm_geometry(f"+{max(x, 0)}+{max(y, 0)}")

    def hide(self, _event=None):
        if self._job is not None:
            try:
                self.widget.after_cancel(self._job)
            except tk.TclError:
                pass
            self._job = None
        if self._win is not None:
            try:
                self._win.destroy()
            except tk.TclError:
                pass
            self._win = None


class CompareCanvas(tk.Canvas):
    """Xem trước/sau: kéo thanh chia, lăn chuột để zoom, kéo bên ngoài thanh để di chuyển ảnh,
    bấm (không kéo) vào ảnh để gọi on_click(x, y) theo tọa độ ảnh gốc."""

    def __init__(self, master, **kw):
        super().__init__(master, bg="#2b2b2b", highlightthickness=0, **kw)
        self.before = self.after_img = None
        self.scale = self.ox = self.oy = 0.0
        self.fit_scale = 1.0
        self.frac = 0.5
        self.mode = None
        self.bg = None          # None: ô caro, hoặc màu (r, g, b)
        self.compare = False    # True: hiện ảnh gốc bên trái thanh chia, kết quả bên phải
        self.on_click = None
        self.on_stroke = None   # gọi khi vẽ xong một nét chắn, với danh sách điểm theo tọa độ ảnh
        self.tool = None        # None, "draw" (vẽ nét chắn) hoặc "erase" (tẩy nét chắn)
        self.space = False      # đang giữ phím Space: kéo chuột trái để di chuyển ảnh
        self.on_erase = None    # gọi khi tẩy tại một điểm (x, y, bán kính theo tọa độ ảnh)
        self.on_erase_done = None
        self.cursors = dict(FALLBACK_CURSORS)
        self.draw_width = 8     # độ dày nét đang vẽ (px theo ảnh)
        self.strokes = []       # nét chắn đã có của ảnh, để hiện lên khi đang ở chế độ vẽ
        self._stroke = []
        self._tk = None
        self._last = self._press = (0, 0)
        self.bind("<Configure>", lambda e: self.on_resize())
        self.bind("<ButtonPress-1>", self.press)
        self.bind("<B1-Motion>", self.drag)
        self.bind("<ButtonRelease-1>", self.release)
        self.bind("<Double-Button-1>", lambda e: self.reset_view())
        # Chuột phải kéo luôn là di chuyển ảnh (chuột trái đang dùng để vẽ khi bật chế độ vẽ)
        self.bind("<ButtonPress-3>", lambda e: setattr(self, "_last", (e.x, e.y)))
        self.bind("<B3-Motion>", self.pan_right)
        self.bind("<MouseWheel>", self.wheel)
        self.bind("<Button-4>", lambda e: self.zoom_at(e.x, e.y, ZOOM_STEP))
        self.bind("<Button-5>", lambda e: self.zoom_at(e.x, e.y, 1 / ZOOM_STEP))

    @property
    def size(self):
        return max(self.winfo_width(), 2), max(self.winfo_height(), 2)

    def clear(self):
        self.before = self.after_img = None
        self.delete("all")

    def set_background(self, color):
        self.bg = color
        self.redraw()

    def set_images(self, before, after, keep_view=True):
        new = self.before is None or before.size != self.before.size or not keep_view
        self.before, self.after_img = before, after
        if new:
            self.reset_view()
        else:
            self.redraw()

    def reset_view(self):
        if self.before is None:
            return
        self.fit_scale, self.ox, self.oy = fit_view(self.before.size, self.size)
        self.scale = self.fit_scale
        self.redraw()

    def on_resize(self):
        if self.before is None:
            return
        fitted = abs(self.scale - self.fit_scale) < 1e-9
        self.fit_scale = fit_view(self.before.size, self.size)[0]
        if fitted:
            self.reset_view()
        else:
            self.redraw()

    def set_compare(self, on):
        self.compare = on
        self.redraw()

    def div_x(self):
        return self.frac * self.size[0] if self.compare else 0   # tắt so sánh: cả khung là kết quả

    def set_tool(self, tool):
        self.tool = tool
        self.update_cursor()
        self.redraw()

    def set_space(self, on):
        if on != self.space:
            self.space = on
            self.update_cursor()

    def update_cursor(self):
        cursor = "fleur" if self.space else self.cursors.get(self.tool, "") if self.tool else ""
        try:
            self.config(cursor=cursor)
        except tk.TclError:   # con trỏ tự vẽ không nạp được: dùng con trỏ có sẵn
            self.config(cursor=FALLBACK_CURSORS.get(self.tool, "") if not self.space else "fleur")

    def to_image(self, e):
        return (e.x - self.ox) / self.scale, (e.y - self.oy) / self.scale

    def pan_right(self, e):
        if self.before is None:
            return
        self.ox += e.x - self._last[0]
        self.oy += e.y - self._last[1]
        self._last = (e.x, e.y)
        self.redraw()

    def erase_at(self, e, first=False):
        """Tẩy dọc đoạn từ vị trí chuột trước tới vị trí hiện tại, để kéo nhanh không nhảy qua nét mảnh."""
        if not self.on_erase:
            return
        x, y = self.to_image(e)
        tol = 6 / self.scale   # dung sai 6 px trên màn hình
        px, py = (x, y) if first else self._erase_last
        n = max(1, int(np.hypot(x - px, y - py) / max(tol / 2, 0.5)))
        for k in range(n + 1):
            self.on_erase(px + (x - px) * k / n, py + (y - py) * k / n, tol)
        self._erase_last = (x, y)

    def press(self, e):
        self._last = self._press = (e.x, e.y)
        self.focus_set()   # để phím tắt (B, E, Space) không bị ô chọn đang có tiêu điểm "nuốt" mất
        if self.space:
            self.mode = "move"   # giữ Space: chỉ di chuyển ảnh, không vẽ, không chọn vùng
        elif self.compare and abs(e.x - self.div_x()) <= GRAB:
            self.mode = "div"
            self.drag(e)
        elif self.tool == "erase" and self.before is not None:
            self.mode = "erase"
            self.erase_at(e, first=True)
        elif self.tool == "draw" and self.before is not None:
            self.mode = "draw"
            x, y = self.to_image(e)
            self._stroke = [[round(x, 1), round(y, 1)]]
            r = max(1.0, self.draw_width * self.scale / 2)
            self.create_oval(e.x - r, e.y - r, e.x + r, e.y + r, fill=STROKE_COLOR, outline="", tags="live")
        else:
            self.mode = "pan"

    def drag(self, e):
        if self.before is None:
            return
        if self.mode == "erase":
            self.erase_at(e)
            return
        if self.mode == "draw":
            x, y = self.to_image(e)
            lx, ly = self._stroke[-1]
            if abs(x - lx) + abs(y - ly) >= 1:
                self._stroke.append([round(x, 1), round(y, 1)])
                self.create_line(lx * self.scale + self.ox, ly * self.scale + self.oy, e.x, e.y, fill=STROKE_COLOR,
                                 width=max(1.0, self.draw_width * self.scale), capstyle="round", tags="live")
            return
        if self.mode == "div":
            self.frac = min(max(e.x / self.size[0], 0.0), 1.0)
        elif self.mode in ("pan", "move"):
            self.ox += e.x - self._last[0]
            self.oy += e.y - self._last[1]
            self._last = (e.x, e.y)
        self.redraw()

    def release(self, e):
        if self.mode == "move":
            self.mode = None
            return
        if self.mode == "erase":
            self.mode = None
            if self.on_erase_done:
                self.on_erase_done()
            return
        if self.mode == "draw":
            self.mode = None
            stroke, self._stroke = self._stroke, []
            if stroke and self.on_stroke:
                self.on_stroke(stroke)
            return
        moved = abs(e.x - self._press[0]) + abs(e.y - self._press[1])
        if self.mode == "pan" and moved <= CLICK_MAX and self.on_click and self.before is not None:
            x, y = int((e.x - self.ox) / self.scale), int((e.y - self.oy) / self.scale)
            w, h = self.before.size
            if 0 <= x < w and 0 <= y < h:
                self.on_click(x, y)
        self.mode = None

    def wheel(self, e):
        self.zoom_at(e.x, e.y, ZOOM_STEP if e.delta > 0 else 1 / ZOOM_STEP)

    def zoom_at(self, x, y, factor):
        if self.before is None:
            return
        new = min(max(self.scale * factor, self.fit_scale), self.fit_scale * MAX_ZOOM)
        k = new / self.scale
        self.ox = x - (x - self.ox) * k
        self.oy = y - (y - self.oy) * k
        self.scale = new
        if abs(new - self.fit_scale) < 1e-9:
            self.reset_view()
        else:
            self.redraw()

    def redraw(self):
        if self.before is None:
            return
        w, h = self.size
        img = render_view(self.before, self.after_img, (w, h), self.scale, self.ox, self.oy, self.div_x(), self.bg)
        if self._tk is not None and self._tk.width() == w and self._tk.height() == h:
            self._tk.paste(img)  # dùng lại bộ nhớ ảnh cũ, nhanh hơn tạo mới
        else:
            self._tk = ImageTk.PhotoImage(img)
        self.delete("all")
        self.create_image(0, 0, image=self._tk, anchor="nw")
        if self.tool:
            self.draw_strokes()
        if not self.compare:
            return
        x = self.div_x()
        # Viền tối quanh thanh trắng để vẫn thấy rõ khi nền xem trước màu trắng
        self.create_line(x, 0, x, h, fill="#222222", width=4)
        self.create_line(x, 0, x, h, fill="white", width=2)
        self.create_oval(x - 16, h / 2 - 16, x + 16, h / 2 + 16, fill="white", outline="#666")
        self.create_text(x, h / 2, text="<>", fill="#333", font=("Arial", 10, "bold"))
        self.label(8, 8, "Trước", "nw")
        self.label(w - 8, 8, "Sau", "ne")

    def draw_strokes(self):
        """Hiện các nét chắn (chỉ để xem, không nằm trong ảnh kết quả)."""
        for st in self.strokes:
            pts = [(x * self.scale + self.ox, y * self.scale + self.oy) for x, y in st["pts"]]
            w = max(1.0, st["w"] * self.scale)
            if len(pts) > 1:
                self.create_line(*[c for p in pts for c in p], fill=STROKE_COLOR, width=w, capstyle="round",
                                 joinstyle="round")
            else:
                (x, y), r = pts[0], w / 2
                self.create_oval(x - r, y - r, x + r, y + r, fill=STROKE_COLOR, outline="")

    def label(self, x, y, text, anchor):
        t = self.create_text(x, y, text=text, fill="white", anchor=anchor, font=("Arial", 10, "bold"))
        bx = self.bbox(t)
        r = self.create_rectangle(bx[0] - 6, bx[1] - 3, bx[2] + 6, bx[3] + 3, fill="#444", outline="")
        self.tag_lower(r, t)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Công cụ tách nền ảnh thiết kế - phiên bản {VERSION}")
        self.geometry("1400x900")
        self.files, self.index = [], 0
        self.src = self.remover = self.result = None
        self.fast = None          # Remover của bản thu nhỏ, chỉ luồng xem nhanh được dùng
        self.result_is_preview = False   # đang hiện bản xem nhanh, hoặc kết quả đầy đủ chưa tính xong
        # Dữ liệu riêng của từng ảnh: vùng đã bấm, cấu hình các thanh trượt, lịch sử hoàn tác
        self.flips = {}           # đường dẫn -> các điểm người dùng bấm để đổi xóa/giữ vùng nền
        self.doc_settings = {}    # đường dẫn -> cấu hình các thanh trượt của ảnh đó
        self.hists = {}           # đường dẫn -> {"undo": [], "redo": [], "committed": trạng thái}
        self._cache = OrderedDict()   # đường dẫn -> (ảnh, Remover, Remover thu nhỏ) của các ảnh vừa mở
        self._job = self._quick_poll = self._full_poll = None
        self._gen = 0             # tăng mỗi lần đổi tùy chọn, tính đầy đủ hoặc đổi ảnh để bỏ các kết quả cũ
        self._full_shown_gen = -1
        self._restoring = False
        self._batch = None        # trạng thái xử lý cả lô đang chạy
        self._threshold_save = None
        self.worker = PreviewWorker()        # tính bản xem nhanh
        self.full_worker = PreviewWorker()   # tính kết quả đầy đủ
        self.store = Store()
        self.learner = Learner()
        self._suggested = set()   # ảnh đã được đề xuất vùng nền, để không đề xuất lại sau khi người dùng khôi phục
        self.suggested = {}       # đường dẫn -> các điểm do ứng dụng đề xuất (cũng nằm trong flips)
        self.barriers = {}        # đường dẫn -> các nét chắn người dùng vẽ: [{"pts": [[x, y], ...], "w": px}]
        self._learn_warned = False
        self.profile = None       # tên cấu hình đang áp dụng

        self.bg = tk.StringVar(value="auto")
        self.tol = tk.DoubleVar(value=0.06)
        self.opq = tk.DoubleVar(value=0.8)
        self.connected = tk.BooleanVar(value=True)
        self.close_gaps = tk.BooleanVar(value=False)
        self.bridge_on = tk.BooleanVar(value=False)
        self.corners_on = tk.BooleanVar(value=True)
        self.corner_light = tk.DoubleVar(value=0.45)
        self.smooth = tk.DoubleVar(value=1.0)
        self.view_bg = tk.StringVar(value=next(iter(PREVIEW_BGS)))
        self.profile_var = tk.StringVar()
        self.auto_suggest = tk.BooleanVar(value=True)
        self.compare_on = tk.BooleanVar(value=False)
        self.draw_on = tk.BooleanVar(value=False)
        self.erase_on = tk.BooleanVar(value=False)
        self._erased = False
        self.barrier_w = tk.IntVar(value=8)
        self.threshold = tk.DoubleVar(value=self.learner.threshold)

        bold = tkfont.nametofont("TkDefaultFont").copy()
        bold.configure(weight="bold")
        style = ttk.Style(self)
        for name in ("Feature.TLabel", "Feature.TCheckbutton", "Feature.TButton", "Feature.TRadiobutton"):
            style.configure(name, font=bold)
        style.configure("Desc.TLabel", foreground="#555555")

        # --- Thanh trên cùng: file, hoàn tác, công cụ nét chắn, cấu hình ---
        bar = ttk.Frame(self, padding=(8, 8, 8, 0))
        bar.pack(fill="x")

        # Nhóm cấu hình nằm bên phải, dựng trước để luôn đủ chỗ khi cửa sổ hẹp
        right = ttk.Frame(bar)
        right.pack(side="right", padx=(8, 0))
        menu_btn = ttk.Menubutton(right, text="Lưu / Xóa", takefocus=0)
        menu = tk.Menu(menu_btn, tearoff=False)
        menu.add_command(label="Lưu cấu hình hiện tại...", command=self.save_profile)
        menu.add_command(label="Đặt cấu hình đang chọn làm mặc định", command=self.set_default_profile)
        menu.add_command(label="Xóa cấu hình đang chọn", command=self.delete_profile)
        menu_btn["menu"] = menu
        self.profile_menu = menu
        menu_btn.pack(side="right")
        Tooltip(menu_btn, "Lưu các tùy chọn đang dùng thành một cấu hình có tên, đặt cấu hình mặc định khi mở ứng dụng, hoặc xóa cấu hình.")
        self.profile_box = ttk.Combobox(right, textvariable=self.profile_var, state="readonly", width=18)
        self.profile_box.pack(side="right", padx=(4, 4))
        self.profile_box.bind("<<ComboboxSelected>>", self.on_profile_selected)
        Tooltip(self.profile_box, "Chọn để áp dụng một bộ tùy chọn đã lưu cho ảnh đang mở.")
        ttk.Label(right, text="Cấu hình:").pack(side="right")

        def tool_button(text, command, tip, gap=4):
            b = ttk.Button(bar, text=text, command=command, width=-6)   # không ép bề rộng tối thiểu của giao diện
            b.pack(side="left", padx=(gap, 0))
            Tooltip(b, tip)
            return b

        tool_button("Chọn ảnh", self.pick, "Mở một hay nhiều ảnh (cũng có thể kéo thả ảnh hoặc thư mục vào cửa sổ).", gap=0)
        tool_button("Lưu ảnh này", self.save_one, "Lưu ảnh đang mở thành PNG nền trong suốt.")
        self.batch_btn = tool_button("Xử lý cả lô", self.save_all, "Tách nền và lưu tất cả ảnh đang mở vào một thư mục.")
        tool_button("Đóng ảnh này", self.close_current, "Bỏ ảnh đang mở khỏi danh sách.")
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)
        tool_button("Hoàn tác", self.undo, "Hoàn tác thao tác vừa làm (Ctrl+Z).", gap=0)
        tool_button("Làm lại", self.redo, "Làm lại thao tác vừa hoàn tác (Ctrl+Y).")
        tool_button("Khôi phục ảnh gốc", self.restore_original, "Bỏ mọi vùng đã bấm chọn và nét chắn của ảnh đang mở.")
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)
        draw = ttk.Checkbutton(bar, text="Vẽ nét chắn (B)", variable=self.draw_on, style="Toolbutton", command=self.toggle_draw)
        draw.pack(side="left")
        Tooltip(draw, "Bật rồi kéo chuột trái vẽ qua chỗ hở của viền để nền không tràn vào trong. "
                      "Nét chắn không xuất hiện trong ảnh lưu ra. Phím tắt: B.")
        erase = ttk.Checkbutton(bar, text="Tẩy (E)", variable=self.erase_on, style="Toolbutton", command=self.toggle_erase)
        erase.pack(side="left", padx=(4, 0))
        Tooltip(erase, "Bật rồi bấm hoặc kéo chuột trái qua nét chắn để xóa từng nét. Phím tắt: E.")
        tool_button("Xóa nét chắn", self.clear_barriers, "Bỏ mọi nét chắn đã vẽ trên ảnh đang mở (Ctrl+Z để lấy lại).")

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, padx=8, pady=8)
        side = ttk.Frame(body)
        side.pack(side="left", fill="y")
        ttk.Label(side, text="Ảnh đang mở (bấm để chọn):").pack(anchor="w")
        self.listbox = tk.Listbox(side, width=28, exportselection=False, activestyle="none")
        scroll = ttk.Scrollbar(side, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=scroll.set)
        self.listbox.pack(side="left", fill="y")
        scroll.pack(side="left", fill="y")
        self.listbox.bind("<<ListboxSelect>>", self.on_list_select)
        panel = ScrollPanel(body, PANEL_WIDTH)
        panel.pack(side="right", fill="y", padx=(8, 0))

        # --- Khung ảnh, bên dưới là thanh hiển thị ---
        center = ttk.Frame(body)
        center.pack(side="left", fill="both", expand=True, padx=(8, 0))
        viewbar = ttk.Frame(center, padding=(0, 6, 0, 0))
        viewbar.pack(side="bottom", fill="x")
        self.view = CompareCanvas(center)
        self.view.on_click = self.on_click
        self.view.on_stroke = self.on_stroke
        self.view.on_erase = self.on_erase
        self.view.on_erase_done = self.on_erase_done
        self.view.cursors = cursor_specs()
        self.view.pack(side="top", fill="both", expand=True)
        ttk.Label(viewbar, text="Nền xem thử:").pack(side="left")
        box = ttk.Combobox(viewbar, textvariable=self.view_bg, state="readonly", width=20, values=list(PREVIEW_BGS))
        box.pack(side="left", padx=(4, 12))
        box.bind("<<ComboboxSelected>>", lambda e: self.view.set_background(PREVIEW_BGS[self.view_bg.get()]))
        Tooltip(box, "Màu nền để xem kết quả; ảnh lưu ra vẫn trong suốt.")
        cmp_box = ttk.Checkbutton(viewbar, text="So sánh trước/sau", variable=self.compare_on,
                                  command=lambda: self.view.set_compare(self.compare_on.get()))
        cmp_box.pack(side="left", padx=(0, 12))
        Tooltip(cmp_box, "Hiện ảnh gốc bên trái, kết quả bên phải; kéo thanh chia để so sánh.")
        fit = ttk.Button(viewbar, text="Vừa khung", command=lambda: self.view.reset_view())
        fit.pack(side="left")
        Tooltip(fit, "Trả ảnh về vừa khung sau khi phóng to/thu nhỏ (hoặc bấm đúp vào ảnh).")

        # --- Bảng bên phải: chỉ những thứ dùng với mọi ảnh; phần còn lại nằm trong "Nâng cao" ---
        p = panel.inner
        lab = ttk.Label(p, text="Màu nền ảnh gốc", style="Feature.TLabel")
        lab.pack(anchor="w", pady=(4, 0))
        radios = ttk.Frame(p)
        radios.pack(anchor="w", pady=(0, 10))
        for label, v in (("Tự động", "auto"), ("Nền trắng", "white"), ("Nền đen", "black")):
            ttk.Radiobutton(radios, text=label, value=v, variable=self.bg, command=self.schedule).pack(side="left", padx=(0, 8))
        for w in (lab, radios, *radios.winfo_children()):
            Tooltip(w, "Tự nhận nền trắng hay đen; chọn tay nếu ứng dụng nhận sai.")
        self.slider_feature(p, "Độ nhạy", self.tol, 0, 0.4, 0.01,
                            "Tăng nếu còn vệt nền; quá cao (từ khoảng 0,2) sẽ ăn vào phần trắng bên trong.")
        self.slider_feature(p, "Làm mịn viền (px)", self.smooth, 0, 2, 0.1,
                            "Thêm quầng mềm ở ngoài mép để bớt răng cưa; mặc định 1, ảnh nhỏ (khoảng 2000 px) nên dùng 0,6.")
        ttk.Separator(p).pack(fill="x", pady=(4, 10))
        self.button_feature(p, "Đề xuất vùng nền", self.suggest_now,
                            "Tự chọn các khoảng nền kín nên xóa theo những gì ứng dụng đã học.")
        self.button_feature(p, "Học từ ảnh này", self.learn_now,
                            "Lấy các khoảng nền đang xóa/giữ trên ảnh này làm đáp án để ứng dụng học. "
                            "Chỉ bấm khi kết quả của ảnh đã đúng.")
        self.check_feature(p, "Tự đề xuất khi mở ảnh", self.auto_suggest,
                           "Tự chạy đề xuất cho mỗi ảnh mới mở và khi xử lý cả lô.", command=lambda: None)
        ttk.Separator(p).pack(fill="x", pady=(4, 6))
        self.adv_open = False
        self.adv_btn = ttk.Button(p, command=self.toggle_advanced)
        self.adv_btn.pack(anchor="w", pady=(0, 6))
        Tooltip(self.adv_btn, "Các tùy chọn ít khi phải đổi: độ đặc, góc nhọn, khe hở, nét mảnh, ngưỡng đề xuất, dữ liệu đã học.")
        self.adv = ttk.Frame(p)
        a = self.adv
        self.slider_feature(a, "Độ đặc", self.opq, 0.3, 1.0, 0.01,
                            "Giảm nếu màu nhạt bị trong suốt; tăng để viền chuyển mềm hơn.")
        self.slider_feature(a, "Độ nhạy góc nhọn", self.corner_light, 0.2, 0.65, 0.05,
                            "Cao hơn thì xóa được cả vệt nhạt màu ở góc nhọn; chỉ tác động khe hẹp sát nền.")
        self.slider_feature(a, "Độ dày nét chắn", self.barrier_w, 2, 40, 1,
                            "Độ dày nét chắn vẽ tiếp theo, tính theo pixel của ảnh; nên vừa đủ phủ kín chỗ hở.",
                            integer=True, on_change=lambda: setattr(self.view, "draw_width", self.barrier_w.get()))
        self.check_feature(a, "Xóa vệt trắng ở góc nhọn", self.corners_on,
                           "Làm sạch vệt nền còn sót trong khe hẹp giữa hai nét viền; vệt ở chỗ hai nét gần chạm nhau "
                           "được tô bằng màu nét bên cạnh để không thủng vào phần trắng bên trong.")
        self.check_feature(a, "Bịt khe hở nét vẽ", self.close_gaps,
                           "Chặn nền rò vào bên trong qua khe hở nhỏ của nét viền.")
        self.check_feature(a, "Xuyên nét mảnh", self.bridge_on,
                           "Xóa luôn các khoảng nền bị dây đèn, nét chữ chia cắt; độ dày tự tính theo kích thước ảnh.")
        self.check_feature(a, "Chỉ xóa nền nối với mép ảnh", self.connected,
                           "Giữ lại phần trắng/đen nằm bên trong thiết kế (găng tay, mắt, viền lông...). "
                           "Tắt thì xóa mọi pixel gần màu nền, kể cả bên trong hình.")
        ttk.Separator(a).pack(fill="x", pady=(6, 10))
        self.slider_feature(a, "Ngưỡng đề xuất", self.threshold, 0.05, 0.95, 0.05,
                            "Thấp: đề xuất nhiều vùng hơn nhưng dễ xóa nhầm hơn.", on_change=self.on_threshold)
        self.learn_label = ttk.Label(a, style="Desc.TLabel", wraplength=DESC_WRAP, justify="left")
        self.learn_label.pack(anchor="w", pady=(0, 8))
        self.button_feature(a, "Xóa dữ liệu đã học", self.forget, "Bỏ toàn bộ dữ liệu đã học để học lại từ đầu.")
        self.update_learn_label()
        self.toggle_advanced(False)

        self.status = ttk.Label(
            self, padding=(8, 0, 8, 8), wraplength=1360,
            text="Chọn ảnh hoặc kéo thả ảnh/thư mục vào cửa sổ để bắt đầu (có thể mở nhiều ảnh, mỗi ảnh giữ riêng chỉnh sửa của nó). "
                 "Lăn chuột để phóng to/thu nhỏ, kéo ảnh (hoặc giữ Space rồi kéo) để di chuyển, bấm đúp hoặc nút \"Vừa khung\" "
                 "để về khung ban đầu. Phím tắt: B vẽ nét chắn, E tẩy nét chắn. "
                 "Bấm vào một khoảng nền để đổi giữa xóa và giữ vùng đó.",
        )
        self.status.pack(fill="x")

        self.drop_enabled = self.enable_drop()
        # Nút và ô chọn không nhận tiêu điểm bàn phím, để Space/B/E không vô tình bấm lại nút vừa bấm
        stack = list(self.winfo_children())
        while stack:
            w = stack.pop()
            stack.extend(w.winfo_children())
            if w.winfo_class() in ("TButton", "TCheckbutton", "TRadiobutton", "TMenubutton", "Toolbutton"):
                w.configure(takefocus=0)
        for key, action in (("b", self.key_draw), ("B", self.key_draw), ("e", self.key_erase), ("E", self.key_erase)):
            self.bind_all(f"<KeyPress-{key}>", action)
        self.bind_all("<KeyPress-space>", lambda e: self.key_space(e, True))
        self.bind_all("<KeyRelease-space>", lambda e: self.key_space(e, False))
        self.bind_all("<Escape>", lambda e: self.set_tool(None) if not self.typing() else None)
        self.bind_all("<Control-z>", self.undo)
        self.bind_all("<Control-Z>", self.undo)
        self.bind_all("<Control-y>", self.redo)
        self.bind_all("<Control-Y>", self.redo)
        self.refresh_profiles()
        if self.store.default:
            self.apply_profile(self.store.default)
            self.refresh_profiles()

    def destroy(self):
        for job in (self._job, self._quick_poll, self._full_poll, self._threshold_save):
            if job:
                self.after_cancel(job)
        if self._batch is not None:
            self._batch["stop"].set()
            self._batch["ex"].shutdown(wait=False, cancel_futures=True)
        if self._threshold_save:
            self.learner.save()
        self.worker.close()
        self.full_worker.close()
        super().destroy()

    # --- Dựng các khối tính năng: tên in đậm, mô tả hiện khi rê chuột vào ---
    def toggle_advanced(self, show=None):
        """Mở/đóng phần tùy chọn nâng cao của bảng bên phải."""
        self.adv_open = (not self.adv_open) if show is None else show
        if self.adv_open:
            self.adv.pack(fill="x")
        else:
            self.adv.pack_forget()
        self.adv_btn.config(text="Nâng cao (bấm để đóng)" if self.adv_open else "Nâng cao (bấm để mở)")

    def check_feature(self, parent, name, var, desc, command=None):
        w = ttk.Checkbutton(parent, text=name, variable=var, style="Feature.TCheckbutton", command=command or self.schedule)
        w.pack(anchor="w", pady=(0, 8))
        Tooltip(w, desc)

    def slider_feature(self, parent, name, var, lo, hi, step, desc, **kw):
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=(0, 10))
        self.numeric_slider(row, name, var, lo, hi, step, bold=True, **kw)
        for w in (row, *row.winfo_children()):
            Tooltip(w, desc)

    def button_feature(self, parent, name, command, desc):
        w = ttk.Button(parent, text=name, command=command, style="Feature.TButton")
        w.pack(anchor="w", pady=(0, 8))
        Tooltip(w, desc)

    def numeric_slider(self, parent, text, var, lo, hi, step, integer=False, on_change=None, bold=False):
        """Thanh trượt kèm ô nhập số: kéo thanh (làm tròn theo bước) hoặc gõ số rồi nhấn Enter."""
        decimals = 0 if integer else max(0, -int(np.floor(np.log10(step) + 1e-9)))
        fmt = "{:.%df}" % decimals

        def quantize(v):
            v = min(max(float(v), lo), hi)
            v = min(max(round(v / step) * step, lo), hi)
            return int(round(v)) if integer else round(v, decimals + 1)

        txt = tk.StringVar(value=fmt.format(var.get()))
        if bold:
            ttk.Label(parent, text=text, style="Feature.TLabel", width=18).pack(side="left")
        else:
            ttk.Label(parent, text=text).pack(side="left", padx=(8, 2))

        changed = on_change or self.schedule

        def on_scale(v):
            var.set(quantize(v))
            changed()

        ttk.Scale(parent, from_=lo, to=hi, variable=var, command=on_scale).pack(side="left")

        def on_text(_event=None):
            try:
                v = quantize(float(txt.get().strip().replace(",", ".")))
            except ValueError:
                txt.set(fmt.format(var.get()))  # gõ sai: trả về giá trị hiện tại
                return
            if v != var.get():
                var.set(v)
                changed()
            txt.set(fmt.format(v))

        spin = ttk.Spinbox(parent, from_=lo, to=hi, increment=step, textvariable=txt, width=6,
                           format="%." + str(decimals) + "f", command=on_text)
        spin.pack(side="left", padx=(4, 0))
        spin.bind("<Return>", on_text)
        spin.bind("<KP_Enter>", on_text)
        spin.bind("<FocusOut>", on_text)

        def sync(*_):
            try:
                txt.set(fmt.format(var.get()))
            except (tk.TclError, ValueError):
                pass

        var.trace_add("write", sync)  # ô số đi theo giá trị, kể cả khi đổi từ nơi khác (hoàn tác, cấu hình)

    @property
    def path(self):
        return self.files[self.index]

    # --- Danh sách ảnh đang mở ---
    def list_labels(self):
        """Tên từng ảnh; nếu trùng tên thì thêm tên thư mục cha để phân biệt."""
        names = [p.name for p in self.files]
        return [f"{p.name}  ({p.parent.name})" if names.count(p.name) > 1 else p.name for p in self.files]

    def refresh_list(self):
        self.listbox.delete(0, "end")
        for label in self.list_labels():
            self.listbox.insert("end", label)
        self.sync_list()

    def sync_list(self):
        self.listbox.selection_clear(0, "end")
        if self.files:
            self.listbox.selection_set(self.index)
            self.listbox.see(self.index)

    def on_list_select(self, _event=None):
        sel = self.listbox.curselection()
        if sel and self.files and sel[0] != self.index:
            self.load(sel[0])

    def options(self):
        return self.options_from(self.settings(), self.src.size if self.src is not None else None)

    @staticmethod
    def options_from(d, size=None):
        """Tùy chọn xử lý từ một cấu hình; `size` là kích thước ảnh để tính độ dày xuyên nét mảnh."""
        bridge = auto_bridge(size) if size and d.get("bridge_on", False) else 0
        return Options(d["bg"], d["tolerance"], d["opaque"], d["connected"], d["close_gaps"], d.get("smooth", 0.0), bridge,
                       d.get("corners", True), d.get("corner_light", 0.45))

    # --- Cấu hình có tên ---
    def settings(self):
        return {"bg": self.bg.get(), "tolerance": round(self.tol.get(), 4), "opaque": round(self.opq.get(), 4),
                "connected": self.connected.get(), "close_gaps": self.close_gaps.get(),
                "bridge_on": self.bridge_on.get(), "corners": self.corners_on.get(),
                "corner_light": round(self.corner_light.get(), 3),
                "smooth": round(self.smooth.get(), 3)}

    def apply_settings(self, d):
        for key, var, cast in (("bg", self.bg, str), ("tolerance", self.tol, float), ("opaque", self.opq, float),
                               ("connected", self.connected, bool), ("close_gaps", self.close_gaps, bool),
                               ("smooth", self.smooth, float),
                               ("bridge_on", self.bridge_on, bool), ("corners", self.corners_on, bool),
                               ("corner_light", self.corner_light, float)):
            if key in d:
                try:
                    var.set(cast(d[key]))
                except (TypeError, ValueError, tk.TclError):
                    pass
        if "bridge_on" not in d and "bridge" in d:
            self.bridge_on.set(bool(d["bridge"]))  # cấu hình cũ lưu độ dày px thay cho bật/tắt
        if self.bg.get() not in ("auto", "white", "black"):
            self.bg.set("auto")

    def profile_label(self, name):
        return name + (" (mặc định)" if name == self.store.default else "")

    def refresh_profiles(self):
        self.profile_box.config(values=[self.profile_label(n) for n in self.store.names])
        self.profile_var.set(self.profile_label(self.profile) if self.profile in self.store.profiles else "")

    def selected_profile(self):
        label = self.profile_var.get()
        return next((n for n in self.store.names if self.profile_label(n) == label), None)

    def apply_profile(self, name):
        data = dict(self.store.profiles[name])
        bg_name = data.pop("view_bg", None)
        compare = data.pop("compare", None)
        self.apply_settings(data)
        if compare is not None:
            self.compare_on.set(bool(compare))
            self.view.set_compare(bool(compare))
        if bg_name in PREVIEW_BGS:
            self.view_bg.set(bg_name)
            self.view.set_background(PREVIEW_BGS[bg_name])
        self.profile = name
        self.schedule()

    def on_profile_selected(self, _event=None):
        name = self.selected_profile()
        if name:
            self.apply_profile(name)

    def save_profile(self):
        name = simpledialog.askstring("Lưu cấu hình", "Đặt tên cho cấu hình:", initialvalue=self.profile or "", parent=self)
        name = (name or "").strip()
        if not name:
            return
        if name in self.store.profiles and not messagebox.askyesno("Ghi đè cấu hình", f"Đã có cấu hình \"{name}\". Ghi đè lên cấu hình này?"):
            return
        self.store.put(name, dict(self.settings(), view_bg=self.view_bg.get(), compare=self.compare_on.get()))
        self.profile = name
        self.refresh_profiles()
        self.status.config(text=f"Đã lưu cấu hình \"{name}\".")

    def set_default_profile(self):
        name = self.selected_profile()
        if not name:
            messagebox.showinfo("Đặt làm mặc định", "Hãy chọn một cấu hình trong danh sách (hoặc lưu cấu hình hiện tại) trước.")
            return
        self.store.set_default(name)
        self.refresh_profiles()
        self.status.config(text=f"Cấu hình \"{name}\" sẽ được áp dụng mỗi khi mở ứng dụng.")

    def delete_profile(self):
        name = self.selected_profile()
        if not name:
            return
        if messagebox.askyesno("Xóa cấu hình", f"Xóa cấu hình \"{name}\"?"):
            self.store.delete(name)
            self.profile = None
            self.refresh_profiles()

    # --- Lịch sử thao tác (Ctrl+Z), riêng cho từng ảnh ---
    def hist(self):
        return self.hists.setdefault(self.path, {"undo": [], "redo": [], "committed": None})

    def state(self):
        return {"settings": self.settings(), "flips": [list(p) for p in self.flips.get(self.path, [])],
                "suggested": [list(p) for p in self.suggested.get(self.path, [])],
                "barriers": json.loads(json.dumps(self.barriers.get(self.path, [])))}

    def commit_history(self):
        h, cur = self.hist(), self.state()
        if self._restoring or h["committed"] is None:
            h["committed"] = cur
        elif cur != h["committed"]:
            h["undo"].append(h["committed"])
            del h["undo"][:-HISTORY_MAX]
            h["redo"].clear()
            h["committed"] = cur

    def restore(self, st):
        self._restoring = True
        try:
            self.apply_settings(st["settings"])
            self.flips[self.path] = [tuple(p) for p in st["flips"]]
            self.suggested[self.path] = [tuple(p) for p in st.get("suggested", [])]
            self.barriers[self.path] = json.loads(json.dumps(st.get("barriers", [])))
            self.apply_barrier()
            self.refresh()
        finally:
            self._restoring = False

    def flush(self):
        """Tính ngay thao tác đang chờ để nó được ghi vào lịch sử trước khi hoàn tác hoặc đổi ảnh."""
        if self._job and self.remover is not None:
            self.refresh()

    def undo(self, _event=None):
        if self.remover is not None:
            self.flush()
            h = self.hist()
            if h["undo"]:
                h["redo"].append(self.state())
                self.restore(h["undo"].pop())
        return "break"

    def redo(self, _event=None):
        if self.remover is not None:
            self.flush()
            h = self.hist()
            if h["redo"]:
                h["undo"].append(self.state())
                self.restore(h["redo"].pop())
        return "break"

    def restore_original(self):
        if not self.files:
            return
        n = len(self.flips.get(self.path, []))
        m = len(self.barriers.get(self.path, []))
        if not n and not m:
            messagebox.showinfo("Khôi phục ảnh gốc", "Ảnh này chưa có vùng bấm chọn hay nét chắn nào.")
            return
        what = " và ".join(t for t in (f"{n} vùng đã bấm chọn" if n else "", f"{m} nét chắn" if m else "") if t)
        if messagebox.askyesno(
            "Khôi phục ảnh gốc",
            f"Bạn có chắc muốn khôi phục ảnh gốc?\n\n{what} trên ảnh này sẽ bị xóa, "
            "kết quả quay về như khi chỉ dùng tự động. Có thể hoàn tác bằng Ctrl+Z.",
        ):
            self.flips.pop(self.path, None)
            self.suggested.pop(self.path, None)
            self.barriers.pop(self.path, None)
            self.apply_barrier()
            self.refresh()

    # --- Ảnh ---
    def pick(self):
        """Thêm ảnh vào danh sách (không làm mất chỉnh sửa của các ảnh đang mở) rồi mở ảnh đầu tiên vừa chọn."""
        self.open_paths(filedialog.askopenfilenames(filetypes=[("Ảnh", " ".join("*" + e for e in sorted(EXTS)))]))

    def open_paths(self, paths):
        """Thêm các ảnh vào danh sách rồi mở ảnh đầu tiên trong số đó. Trả về số ảnh hợp lệ."""
        paths = [Path(p) for p in paths]
        if not paths:
            return 0
        # So sánh theo đường dẫn chuẩn hóa: trên Windows cùng một file có thể khác chữ hoa/thường
        same = lambda p: os.path.normcase(os.path.abspath(p))
        opened = {same(f): f for f in self.files}
        paths = [opened.get(same(p), p) for p in paths]
        fresh = [p for p in dict.fromkeys(paths) if p not in self.files]
        self.files.extend(fresh)
        target = paths[0] if not fresh else fresh[0]
        self.refresh_list()
        self.load(self.files.index(target))
        return len(paths)

    # --- Kéo thả ảnh vào cửa sổ ---
    def enable_drop(self):
        """Bật kéo thả file (cần thư viện tkinterdnd2). Thiếu thư viện thì bỏ qua, vẫn dùng được nút "Chọn ảnh"."""
        try:
            from tkinterdnd2 import DND_FILES, TkinterDnD
            TkinterDnD.require(self)
        except Exception:  # noqa: BLE001 - không có kéo thả không phải lỗi nghiêm trọng
            return False
        stack = list(self.winfo_children())
        while stack:   # đăng ký mọi ô trong cửa sổ để thả vào chỗ nào cũng được
            w = stack.pop()
            stack.extend(w.winfo_children())
            try:
                w.drop_target_register(DND_FILES)
                w.dnd_bind("<<Drop>>", self.on_drop)
            except (tk.TclError, AttributeError):
                pass
        return True

    def dropped_images(self, data):
        """Danh sách ảnh từ dữ liệu thả vào: tách đường dẫn (kể cả có dấu cách), mở rộng thư mục, lọc theo đuôi file."""
        out = []
        for raw in self.tk.splitlist(data):
            p = Path(raw)
            if p.is_dir():
                out.extend(sorted(f for f in p.iterdir() if f.is_file() and f.suffix.lower() in EXTS))
            elif p.suffix.lower() in EXTS and p.is_file():
                out.append(p)
        return out

    def on_drop(self, event):
        images = self.dropped_images(event.data)
        if images:
            self.open_paths(images)
            if len(images) > 1:
                self.status.config(text=f"Đã thêm {len(images)} ảnh. " + self.status_text())
        else:
            self.status.config(text="Không có file ảnh hợp lệ trong những gì vừa thả vào (hỗ trợ: " + ", ".join(sorted(EXTS)) + ").")
        return event.action

    def load(self, i):
        # Rời ảnh đang mở: ghi nhận thao tác đang chờ và cấu hình các thanh trượt của nó
        if self.src is not None and self.files:
            self.flush()
            self.doc_settings[self.path] = self.settings()
            if self.remover is not None:
                self.remover._base = None   # bỏ kết quả trung gian của ảnh vừa rời để đỡ tốn bộ nhớ
        self.index = i % len(self.files)
        path = self.path
        self.sync_list()
        if path in self._cache:
            self._cache.move_to_end(path)
            self.src, self.remover, self.fast = self._cache[path]
        else:
            self.src = Image.open(path).convert("RGBA")
            self.remover = Remover(self.src)
            longest = max(self.src.size)
            if longest > PREVIEW_SIDE * 1.3:
                k = PREVIEW_SIDE / longest
                small = self.src.resize((max(1, round(self.src.width * k)), max(1, round(self.src.height * k))), Image.LANCZOS)
                self.fast = Remover(small)
            else:
                self.fast = None
            self._cache[path] = (self.src, self.remover, self.fast)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        self.apply_barrier()
        if path in self.doc_settings:
            self.apply_settings(self.doc_settings[path])      # ảnh đã mở trước đó: khôi phục cấu hình riêng của nó
        else:
            self.doc_settings[path] = self.settings()          # ảnh mới kế thừa cấu hình hiện tại
        h = self.hist()
        if h["committed"] is None:
            h["committed"] = self.state()
        if self.auto_suggest.get() and self.learner.ready and path not in self._suggested and not self.flips.get(path):
            self.status.config(text="Đang đề xuất vùng nền...")
            self.apply_suggestions()
        self.view.set_images(self.src, self.src, keep_view=False)   # hiện ngay ảnh gốc trong lúc tính
        self.refresh()
        if self.fast is not None:
            self.submit_quick()   # bản xem nhanh thường xong trước, kết quả đầy đủ thay vào sau

    # --- Nét chắn ---
    def apply_barrier(self):
        """Đưa nét chắn của ảnh đang mở vào bộ tách nền (cả bản đầy đủ và bản xem nhanh) và khung xem."""
        strokes = self.barriers.get(self.path, [])
        sig = json.dumps(strokes)
        if getattr(self.remover, "strokes_sig", None) != sig:   # chỉ tính lại khi nét chắn thay đổi
            self.remover.set_barrier(barrier_mask(strokes, self.remover.size))
            self.remover.strokes_sig = sig
            if self.fast is not None:
                self.fast.set_barrier(barrier_mask(strokes, self.fast.size, self.fast.w / self.remover.w))
        self.view.strokes = strokes
        self.view.redraw()

    def set_tool(self, tool):
        """Chọn công cụ trên ảnh: None (bấm chọn vùng), "draw" (vẽ nét chắn) hoặc "erase" (tẩy nét chắn)."""
        self.draw_on.set(tool == "draw")
        self.erase_on.set(tool == "erase")
        self.view.draw_width = self.barrier_w.get()
        self.view.set_tool(tool)
        if tool == "draw":
            self.status.config(text="Đang vẽ nét chắn (B): kéo chuột trái qua chỗ hở của viền; giữ Space hoặc kéo chuột phải "
                                    "để di chuyển ảnh, lăn chuột để phóng to. Nhấn B hoặc Esc để thôi vẽ.")
        elif tool == "erase":
            self.status.config(text="Đang tẩy nét chắn (E): bấm hoặc kéo chuột trái qua nét chắn để xóa từng nét. "
                                    "Nhấn E hoặc Esc để thôi tẩy.")
        elif self.remover is not None:
            self.status.config(text=self.status_text())

    def toggle_draw(self):
        self.set_tool("draw" if self.draw_on.get() else None)

    def toggle_erase(self):
        self.set_tool("erase" if self.erase_on.get() else None)

    def typing(self):
        """Đang gõ trong ô nhập (khi đó phím tắt không được dùng)."""
        w = self.focus_get()
        return w is not None and w.winfo_class() in ("TEntry", "TSpinbox", "TCombobox", "Entry", "Spinbox")

    def key_draw(self, _event=None):
        if not self.typing():
            self.set_tool(None if self.view.tool == "draw" else "draw")

    def key_erase(self, _event=None):
        if not self.typing():
            self.set_tool(None if self.view.tool == "erase" else "erase")

    def key_space(self, _event, down):
        if down and self.typing():
            return
        self.view.set_space(down)

    def on_erase(self, x, y, tol):
        """Xóa các nét chắn đi qua điểm (x, y) (theo tọa độ ảnh)."""
        strokes = self.barriers.get(self.path) if self.remover is not None else None
        if not strokes:
            return
        keep = [st for st in strokes if _stroke_distance(st, x, y) > st["w"] / 2 + tol]
        if len(keep) != len(strokes):
            self.barriers[self.path] = keep
            self._erased = True
            self.view.strokes = keep
            self.view.redraw()

    def on_erase_done(self):
        """Tính lại kết quả một lần sau mỗi lượt tẩy (một lượt = một bước Ctrl+Z)."""
        if self._erased:
            self._erased = False
            self.apply_barrier()
            self.refresh()
            if self.fast is not None:
                self.submit_quick()

    def on_stroke(self, points):
        if self.remover is None:
            return
        self.barriers.setdefault(self.path, []).append({"pts": points, "w": int(self.barrier_w.get())})
        if not self.connected.get():
            self.connected.set(True)  # nét chắn chỉ có nghĩa khi xét vùng nền nối với mép ảnh
        self.apply_barrier()
        self.refresh()
        if self.fast is not None:
            self.submit_quick()

    def clear_barriers(self):
        if self.remover is None or not self.barriers.get(self.path):
            self.status.config(text="Ảnh này chưa có nét chắn nào.")
            return
        n = len(self.barriers.pop(self.path))
        self.apply_barrier()
        self.refresh()
        self.status.config(text=f"Đã xóa {n} nét chắn. Ctrl+Z để lấy lại.")

    def close_current(self):
        if not self.files:
            return
        path = self.path
        n = len(self.flips.get(path, []))
        if n and not messagebox.askyesno("Đóng ảnh này", f"Ảnh này có {n} vùng đã bấm chọn. Đóng và bỏ các chỉnh sửa?"):
            return
        if self._job:
            self.after_cancel(self._job)
            self._job = None
        for store in (self.flips, self.suggested, self.barriers, self.doc_settings, self.hists, self._cache):
            store.pop(path, None)
        self._suggested.discard(path)
        del self.files[self.index]
        self.src = None
        self._gen += 1
        self.refresh_list()
        if self.files:
            self.load(min(self.index, len(self.files) - 1))
        else:
            self.remover = self.fast = self.result = None
            self.view.clear()
            self.status.config(text="Đã đóng hết ảnh. Bấm \"Chọn ảnh\" để mở ảnh khác.")

    def status_text(self, extra=""):
        n = len(self.flips.get(self.path, []))
        return f"{self.index + 1}/{len(self.files)}: {self.path.name}  |  vùng đã bấm: {n}{extra}"

    def schedule(self):
        """Vẽ nhanh bản thu nhỏ (tính ở luồng nền) ngay, rồi tính đầy đủ khi người dùng dừng tay."""
        if self._job:
            self.after_cancel(self._job)
        self._gen += 1   # tùy chọn đã đổi: bỏ mọi kết quả đang tính theo tùy chọn cũ
        if self.fast is not None and self.remover is not None:
            self.submit_quick()
            self._job = self.after(FULL_DELAY, self.refresh)
        else:
            self._job = self.after(120, self.refresh)

    def submit_quick(self):
        k = self.fast.w / self.remover.w
        o = self.options()
        o.smooth *= k
        if o.bridge:
            o.bridge = max(1, round(o.bridge * k))
        flips = [(int(x * k), int(y * k)) for x, y in self.flips.get(self.path, [])]
        fast, gen = self.fast, self._gen
        self.worker.submit(lambda: (gen, fast.render(o, flips)))
        if self._quick_poll is None:
            self._quick_poll = self.after(POLL_MS, self.poll_quick)

    def poll_quick(self):
        self._quick_poll = None
        busy = self.worker.busy      # đọc trạng thái trước khi lấy kết quả để không bỏ sót bản vừa xong
        res = self.worker.take()
        if res is not None and res[0] == "error":
            res = None   # lỗi ở bản xem nhanh: bỏ qua, kết quả đầy đủ vẫn được tính
        # Bỏ bản xem nhanh nếu đã cũ, hoặc nếu kết quả đầy đủ của cùng lượt đã hiện rồi
        if res is not None and res[0] == self._gen != self._full_shown_gen and self.remover is not None:
            self.result = res[1]
            self.result_is_preview = True
            self.view.set_images(self.src, self.result)
            self.status.config(text=self.status_text("  |  Xem nhanh (bản thu nhỏ), dừng tay để tính đầy đủ..."))
        if busy:
            self._quick_poll = self.after(POLL_MS, self.poll_quick)

    def refresh(self):
        """Ghi nhận thao tác vào lịch sử rồi tính kết quả đầy đủ ở luồng nền (giao diện vẫn dùng được)."""
        if self._job:
            self.after_cancel(self._job)
        self._job = None
        self._gen += 1
        if self.remover is None:
            return
        self.result_is_preview = True    # cho đến khi kết quả đầy đủ về
        self.commit_history()
        self.doc_settings[self.path] = self.settings()
        o, flips, rem, gen = self.options(), list(self.flips.get(self.path, [])), self.remover, self._gen
        self.full_worker.submit(lambda: (gen, rem.render(o, flips)))
        if self._full_poll is None:
            self._full_poll = self.after(POLL_MS, self.poll_full)
        self.status.config(text=self.status_text("  |  Đang tính..."))

    def poll_full(self):
        self._full_poll = None
        busy = self.full_worker.busy
        res = self.full_worker.take()
        if res is not None and res[0] == "error":
            self.result_is_preview = False
            self.status.config(text=f"Lỗi khi tính kết quả: {res[1]}")
            res = None
        if res is not None and res[0] == self._gen and self.remover is not None:
            self.result = res[1]
            self.result_is_preview = False
            self._full_shown_gen = res[0]
            self.view.set_images(self.src, self.result)
            self.status.config(text=self.status_text())
        if busy:
            self._full_poll = self.after(POLL_MS, self.poll_full)

    def full_result(self):
        """Kết quả đầy đủ của ảnh hiện tại; nếu chưa tính xong thì tính ngay (dùng khi lưu)."""
        if self.remover is None:
            return None
        if self.result_is_preview or self._job:
            self.flush()   # ghi nhận thao tác đang chờ vào lịch sử
            self._gen += 1
            self.result = self.remover.render(self.options(), self.flips.get(self.path, []))
            self.result_is_preview = False
            self._full_shown_gen = self._gen
            self.view.set_images(self.src, self.result)
            self.status.config(text=self.status_text())
        return self.result

    def on_click(self, x, y):
        if self.remover is None:
            return
        if not self.connected.get():
            self.connected.set(True)  # chọn vùng chỉ có nghĩa khi xét vùng nền nối với mép ảnh
        o = self.options()
        lab = self.remover.region_at(o, x, y)
        if not lab:
            self.status.config(text="Điểm này không phải khoảng nền (hãy bấm vào khoảng trắng hoặc đen cần xóa/giữ).")
            return
        if self.remover._regions_for(o)[2][lab]:
            self.status.config(text="Đây là nền ngoài nối với mép ảnh nên không đổi được bằng cách bấm. "
                                    "Hãy chỉnh \"Bịt khe hở nét vẽ\" hoặc \"Độ nhạy\" nếu nền bị rò hay còn sót.")
            return
        self.flips.setdefault(self.path, []).append((x, y))
        self.schedule()   # hiện ngay bản xem nhanh (thu nhỏ), kết quả đầy đủ tính ở nền sau đó

    # --- Học từ lựa chọn của người dùng ---
    def update_learn_label(self):
        n, images, removed = self.learner.stats
        if not n:
            text = "Chưa học gì (bấm chọn vùng rồi bấm \"Học từ ảnh này\")."
        else:
            text = f"Đã học {n} vùng ({removed} xóa, {n - removed} giữ) từ {images} ảnh."
            if not self.learner.ready:
                text += " Cần thêm dữ liệu mới bắt đầu đề xuất."
            else:
                e = self.learner.evaluate()
                if e is None:
                    text += " Cần ít nhất 3 ảnh để ước tính độ chính xác."
                else:
                    need, keep = e["tp"] + e["fn"], e["fp"] + e["tn"]
                    text += (f" Ước tính khi gặp ảnh mới, ở ngưỡng {self.learner.threshold:.2f} (kiểm tra chéo giữa các ảnh): tìm đúng {e['tp']}/{need} vùng cần xóa "
                             f"({100 * e['tp'] / max(need, 1):.0f}%), xóa nhầm {e['fp']}/{keep} vùng cần giữ "
                             f"({100 * e['fp'] / max(keep, 1):.0f}%).")
        self.learn_label.config(text=text)

    def busy(self, on):
        self.config(cursor="watch" if on else "")
        self.update_idletasks()

    def learn_now(self):
        if self.remover is None:
            messagebox.showinfo("Học từ ảnh này", "Hãy chọn ảnh trước.")
            return
        if not self.connected.get():
            messagebox.showinfo("Học từ ảnh này", "Hãy bật \"Chỉ xóa nền nối với mép ảnh\" (trong mục Nâng cao): việc học áp dụng cho các khoảng nền kín.")
            return
        if not self._learn_warned:
            if not messagebox.askyesno(
                "Học từ ảnh này",
                "Ứng dụng sẽ lấy kết quả hiện tại làm đáp án: khoảng nền kín nào đang bị xóa là \"nên xóa\", "
                "các khoảng còn lại là \"nên giữ\".\n\nChỉ nên học khi kết quả của ảnh này đã đúng. Tiếp tục?",
            ):
                return
            self._learn_warned = True
        self.flush()
        self.busy(True)
        try:
            o = self.options()
            ids, X = region_features(self.remover, o)
            if not len(ids):
                messagebox.showinfo("Học từ ảnh này", "Ảnh này không có khoảng nền kín đủ lớn để học.")
                return
            _, remove = self.remover.decide(o, self.flips.get(self.path, []))
            y = remove[ids].astype(int)
            self.learner.add(f"{self.path.resolve()}|{self.src.width}x{self.src.height}", X, y)
            self.update_learn_label()
        finally:
            self.busy(False)
        self.status.config(text=f"Đã học từ ảnh này: {len(ids)} vùng ({int(y.sum())} xóa, {int((1 - y).sum())} giữ).")

    def apply_suggestions(self):
        """Tính lại đề xuất theo ngưỡng hiện tại: bỏ các đề xuất cũ, giữ nguyên các vùng người dùng tự bấm.

        Vùng đã được đề xuất mà người dùng bấm để giữ lại thì không đề xuất lại.
        Trả về (số vùng đề xuất mới, số đề xuất cũ đã bỏ, số vùng người dùng đã từ chối).
        """
        path = self.path
        o = self.options()
        o.connected = True
        self.busy(True)
        try:
            old = [tuple(p) for p in self.suggested.get(path, [])]
            manual = [tuple(p) for p in self.flips.get(path, [])]
            for p in old:
                if p in manual:
                    manual.remove(p)
            old_by_region = {}
            for p in old:
                lab = self.remover.region_at(o, *p)
                if lab:
                    old_by_region.setdefault(lab, []).append(p)
            rejected = {self.remover.region_at(o, *p) for p in manual} & set(old_by_region)
            # Giữ cặp "đề xuất + người dùng bấm lại" của vùng bị từ chối để vùng đó vẫn được giữ
            keep_old = [p for lab in rejected for p in old_by_region[lab]]
            base = manual + keep_old
            points = suggest_points(self.remover, o, base, self.learner, exclude=rejected)
        finally:
            self.busy(False)
        self._suggested.add(path)
        self.flips[path] = base + points
        self.suggested[path] = keep_old + points
        if points:
            self.connected.set(True)
        return len(points), len(old) - len(keep_old), len(rejected)

    def suggest_now(self):
        if self.remover is None:
            messagebox.showinfo("Đề xuất vùng nền", "Hãy chọn ảnh trước.")
            return
        if not self.learner.ready:
            n, _, removed = self.learner.stats
            messagebox.showinfo(
                "Chưa đủ dữ liệu",
                f"Cần ít nhất {MIN_SAMPLES} vùng đã học, trong đó mỗi loại (xóa và giữ) có ít nhất {MIN_PER_CLASS} vùng. "
                f"Hiện có {n} vùng ({removed} xóa).\n\nHãy bấm chọn vùng trên vài ảnh rồi bấm \"Học từ ảnh này\".",
            )
            return
        self.flush()
        new, dropped, rejected = self.apply_suggestions()
        self.refresh()
        th = f"{self.learner.threshold:.2f}"
        if new:
            lines = [f"Đã đề xuất xóa {new} khoảng nền kín (ngưỡng {th})."]
        else:
            lines = [f"Không có khoảng nền kín nào đạt ngưỡng {th}.", "Thử giảm \"Ngưỡng đề xuất\" (trong mục Nâng cao) để có thêm đề xuất."]
        if dropped:
            lines.append(f"Đã bỏ {dropped} đề xuất của lần trước.")
        if rejected:
            lines.append(f"Giữ nguyên {rejected} vùng bạn đã bấm giữ lại.")
        lines.append("Bấm vào vùng để đổi lại, Ctrl+Z để hủy.")
        self.status.config(text=" ".join(lines))
        messagebox.showinfo("Đề xuất vùng nền", "\n".join(lines))

    def on_threshold(self):
        self.learner.threshold = self.threshold.get()
        self.update_learn_label()
        # Ghi file sau khi người dùng dừng kéo, không ghi ở mỗi lần di chuột
        if self._threshold_save:
            self.after_cancel(self._threshold_save)
        self._threshold_save = self.after(600, self._save_threshold)

    def _save_threshold(self):
        self._threshold_save = None
        self.learner.save()

    def forget(self):
        if self.learner.stats[0] and messagebox.askyesno("Xóa dữ liệu đã học", "Xóa toàn bộ dữ liệu đã học? Không thể hoàn tác."):
            self.learner.clear()
            self.update_learn_label()

    # --- Lưu ---
    def save_one(self):
        result = self.full_result()
        if result is None:
            return
        dst = filedialog.asksaveasfilename(
            defaultextension=".png", initialfile=self.path.stem + SUFFIX + ".png", filetypes=[("PNG", "*.png")],
        )
        if dst:
            result.save(dst, "PNG")
            self.status.config(text=f"Đã lưu {dst}")

    def save_all(self):
        if not self.files:
            return
        if self._batch is not None:
            messagebox.showinfo("Xử lý cả lô", "Đang xử lý cả lô. Hãy chờ xong hoặc bấm \"Dừng\".")
            return
        self.flush()
        self.doc_settings[self.path] = self.settings()
        out = filedialog.askdirectory(title="Chọn thư mục lưu")
        if not out:
            return
        jobs = [(f, Path(out) / (f.stem + SUFFIX + ".png")) for f in self.files]
        existing = [dst for _, dst in jobs if dst.exists()]
        if existing:
            answer = messagebox.askyesnocancel(
                "File đã có",
                f"Thư mục đã có {len(existing)} file kết quả trùng tên (ví dụ {existing[0].name}).\n\n"
                "Có: ghi đè các file đó\nKhông: bỏ qua các ảnh đó\nHủy: không xử lý",
            )
            if answer is None:
                return
            if answer is False:
                jobs = [(f, dst) for f, dst in jobs if not dst.exists()]
        skipped = len(self.files) - len(jobs)
        if not jobs:
            messagebox.showinfo("Xử lý cả lô", "Không còn ảnh nào cần xử lý.")
            return
        suggest = self.auto_suggest.get() and self.learner.ready
        if suggest:
            self.learner.prepare()   # dựng mô hình trước khi các luồng dùng chung
        tasks = [(f, dst, dict(self.doc_settings.get(f) or self.settings()), list(self.flips.get(f, [])),
                  suggest and f not in self._suggested and not self.flips.get(f),
                  json.loads(json.dumps(self.barriers.get(f, [])))) for f, dst in jobs]
        stop = threading.Event()
        ex = ThreadPoolExecutor(BATCH_WORKERS)

        dlg = tk.Toplevel(self)
        dlg.title("Xử lý cả lô")
        dlg.transient(self)
        dlg.resizable(False, False)
        label = ttk.Label(dlg, text=f"Đang xử lý 0/{len(tasks)} ảnh...", padding=(16, 12, 16, 4))
        label.pack(fill="x")
        bar = ttk.Progressbar(dlg, length=360, maximum=len(tasks))
        bar.pack(padx=16, pady=4)
        stop_btn = ttk.Button(dlg, text="Dừng", command=self.stop_batch)
        stop_btn.pack(pady=(4, 12))
        dlg.protocol("WM_DELETE_WINDOW", self.stop_batch)

        self._batch = {"ex": ex, "stop": stop, "futures": [ex.submit(self._batch_one, t, stop) for t in tasks],
                       "skipped": skipped, "out": out, "dlg": dlg, "label": label, "bar": bar, "stop_btn": stop_btn}
        self.batch_btn.state(["disabled"])
        self.after(150, self.poll_batch)

    def _batch_one(self, task, stop):
        """Xử lý một ảnh trong luồng nền (không được đụng tới giao diện). Trả về (ảnh, lỗi hoặc None)."""
        f, dst, d, flips, suggest, strokes = task
        if stop.is_set():
            return f, "stopped"
        try:
            img = Image.open(f).convert("RGBA")
            rem = Remover(img)
            if strokes:
                rem.set_barrier(barrier_mask(strokes, img.size))
            opts = self.options_from(d, img.size)
            if strokes:
                opts.connected = True
            if suggest:
                o2 = self.options_from(d, img.size)
                o2.connected = True
                flips = suggest_points(rem, o2, flips, self.learner)
                opts.connected = opts.connected or bool(flips)
            if stop.is_set():
                return f, "stopped"
            tmp = dst.with_name(dst.stem + ".tmp.png")
            rem.render(opts, flips).save(tmp, "PNG")
            os.replace(tmp, dst)   # ghi xong mới thay file, không để lại file hỏng khi dừng giữa chừng
            return f, None
        except Exception as e:  # noqa: BLE001 - báo lỗi từng ảnh thay vì dừng cả lô
            return f, str(e)

    def stop_batch(self):
        b = self._batch
        if b is None or b["stop"].is_set():
            return
        b["stop"].set()
        for fu in b["futures"]:
            fu.cancel()
        b["stop_btn"].state(["disabled"])
        b["label"].config(text="Đang dừng, chờ các ảnh đang xử lý dở xong...")

    def poll_batch(self):
        b = self._batch
        done = sum(fu.done() for fu in b["futures"])
        total = len(b["futures"])
        b["bar"]["value"] = done
        if not b["stop"].is_set():
            b["label"].config(text=f"Đang xử lý {done}/{total} ảnh ({BATCH_WORKERS} ảnh cùng lúc)...")
        if done < total:
            self.after(150, self.poll_batch)
            return
        results = [fu.result() for fu in b["futures"] if not fu.cancelled()]
        ok = sum(err is None for _, err in results)
        errors = [(f, err) for f, err in results if err not in (None, "stopped")]
        b["ex"].shutdown(wait=False)
        b["dlg"].destroy()
        self._batch = None
        self.batch_btn.state(["!disabled"])
        lines = [f"Đã lưu {ok} ảnh vào {b['out']}."]
        if b["skipped"]:
            lines.append(f"Bỏ qua {b['skipped']} ảnh đã có kết quả.")
        if total - ok - len(errors):
            lines.append(f"Đã dừng, {total - ok - len(errors)} ảnh chưa xử lý.")
        if errors:
            lines.append(f"Lỗi {len(errors)} ảnh:\n" + "\n".join(f"- {f.name}: {e}" for f, e in errors[:10]))
        self.status.config(text=lines[0])
        (messagebox.showwarning if errors else messagebox.showinfo)("Xử lý cả lô", "\n".join(lines))


if __name__ == "__main__":
    App().mainloop()
