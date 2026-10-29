"""Ứng dụng máy tính tách nền ảnh thiết kế 2D (nền trắng hoặc đen). Chạy: python app.py"""
import os
import threading
import tkinter as tk
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

import numpy as np
from PIL import Image, ImageTk

from compare import fit_view, render_view
from learn import MIN_PER_CLASS, MIN_SAMPLES, Learner, region_features, suggest_points
from remove_bg import EXTS, SUFFIX, Options, Remover, auto_bridge
from settings import Store

ZOOM_STEP = 1.2
MAX_ZOOM = 64.0
GRAB = 14            # px quanh thanh chia để kéo
CLICK_MAX = 4        # di chuyển tối đa (px) để tính là bấm chứ không phải kéo
PREVIEW_SIDE = 800   # cạnh dài (px) của bản thu nhỏ dùng để xem nhanh khi kéo thanh trượt
POLL_MS = 15         # chu kỳ kiểm tra kết quả xem nhanh từ luồng nền
FULL_DELAY = 350     # ms yên lặng trước khi tính lại đầy đủ
HISTORY_MAX = 100
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
        self.on_click = None
        self._tk = None
        self._last = self._press = (0, 0)
        self.bind("<Configure>", lambda e: self.on_resize())
        self.bind("<ButtonPress-1>", self.press)
        self.bind("<B1-Motion>", self.drag)
        self.bind("<ButtonRelease-1>", self.release)
        self.bind("<Double-Button-1>", lambda e: self.reset_view())
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

    def div_x(self):
        return self.frac * self.size[0]

    def press(self, e):
        self._last = self._press = (e.x, e.y)
        self.mode = "div" if abs(e.x - self.div_x()) <= GRAB else "pan"
        if self.mode == "div":
            self.drag(e)

    def drag(self, e):
        if self.before is None:
            return
        if self.mode == "div":
            self.frac = min(max(e.x / self.size[0], 0.0), 1.0)
        elif self.mode == "pan":
            self.ox += e.x - self._last[0]
            self.oy += e.y - self._last[1]
            self._last = (e.x, e.y)
        self.redraw()

    def release(self, e):
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
        x = self.div_x()
        # Viền tối quanh thanh trắng để vẫn thấy rõ khi nền xem trước màu trắng
        self.create_line(x, 0, x, h, fill="#222222", width=4)
        self.create_line(x, 0, x, h, fill="white", width=2)
        self.create_oval(x - 16, h / 2 - 16, x + 16, h / 2 + 16, fill="white", outline="#666")
        self.create_text(x, h / 2, text="<>", fill="#333", font=("Arial", 10, "bold"))
        self.label(8, 8, "Trước", "nw")
        self.label(w - 8, 8, "Sau", "ne")

    def label(self, x, y, text, anchor):
        t = self.create_text(x, y, text=text, fill="white", anchor=anchor, font=("Arial", 10, "bold"))
        bx = self.bbox(t)
        r = self.create_rectangle(bx[0] - 6, bx[1] - 3, bx[2] + 6, bx[3] + 3, fill="#444", outline="")
        self.tag_lower(r, t)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Công cụ tách nền ảnh thiết kế")
        self.geometry("1200x900")
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
        self._learn_warned = False
        self.profile = None       # tên cấu hình đang áp dụng

        self.bg = tk.StringVar(value="auto")
        self.tol = tk.DoubleVar(value=0.06)
        self.opq = tk.DoubleVar(value=0.8)
        self.connected = tk.BooleanVar(value=True)
        self.close_gaps = tk.BooleanVar(value=False)
        self.bridge_on = tk.BooleanVar(value=True)
        self.smooth = tk.DoubleVar(value=0.0)
        self.view_bg = tk.StringVar(value=next(iter(PREVIEW_BGS)))
        self.profile_var = tk.StringVar()
        self.auto_suggest = tk.BooleanVar(value=True)
        self.threshold = tk.DoubleVar(value=self.learner.threshold)

        bar = ttk.Frame(self, padding=(8, 8, 8, 0))
        bar.pack(fill="x")
        ttk.Button(bar, text="Chọn ảnh", command=self.pick).pack(side="left")
        ttk.Button(bar, text="Lưu ảnh này", command=self.save_one).pack(side="left", padx=4)
        self.batch_btn = ttk.Button(bar, text="Xử lý cả lô", command=self.save_all)
        self.batch_btn.pack(side="left")
        ttk.Button(bar, text="Đóng ảnh này", command=self.close_current).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text="Hoàn tác (Ctrl+Z)", command=self.undo).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text="Làm lại (Ctrl+Y)", command=self.redo).pack(side="left", padx=4)
        ttk.Button(bar, text="Khôi phục ảnh gốc", command=self.restore_original).pack(side="left", padx=(12, 0))

        row2 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row2.pack(fill="x")
        for label, v in (("Tự động", "auto"), ("Nền trắng", "white"), ("Nền đen", "black")):
            ttk.Radiobutton(row2, text=label, value=v, variable=self.bg, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Chỉ xóa nền nối với mép ảnh", variable=self.connected, command=self.schedule).pack(side="left", padx=(12, 4))
        ttk.Checkbutton(row2, text="Xuyên nét mảnh (dây đèn, nét chữ)", variable=self.bridge_on, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Bịt khe hở nét vẽ", variable=self.close_gaps, command=self.schedule).pack(side="left", padx=4)

        row3 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row3.pack(fill="x")
        self.numeric_slider(row3, "Độ nhạy", self.tol, 0, 0.4, 0.01)
        self.numeric_slider(row3, "Độ đặc", self.opq, 0.3, 1.0, 0.01)
        self.numeric_slider(row3, "Làm mịn viền (px)", self.smooth, 0, 2, 0.1)
        ttk.Label(row3, text="(kéo thanh hoặc gõ số rồi nhấn Enter)", foreground="#666").pack(side="left", padx=12)

        row4 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row4.pack(fill="x")
        ttk.Label(row4, text="Cấu hình:").pack(side="left")
        self.profile_box = ttk.Combobox(row4, textvariable=self.profile_var, state="readonly", width=26)
        self.profile_box.pack(side="left", padx=4)
        self.profile_box.bind("<<ComboboxSelected>>", self.on_profile_selected)
        ttk.Button(row4, text="Lưu cấu hình hiện tại...", command=self.save_profile).pack(side="left", padx=2)
        ttk.Button(row4, text="Đặt làm mặc định", command=self.set_default_profile).pack(side="left", padx=2)
        ttk.Button(row4, text="Xóa cấu hình", command=self.delete_profile).pack(side="left", padx=2)
        ttk.Label(row4, text="Nền xem trước:").pack(side="left", padx=(24, 4))
        box = ttk.Combobox(row4, textvariable=self.view_bg, state="readonly", width=18, values=list(PREVIEW_BGS))
        box.pack(side="left")
        box.bind("<<ComboboxSelected>>", lambda e: self.view.set_background(PREVIEW_BGS[self.view_bg.get()]))

        row5 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row5.pack(fill="x")
        ttk.Label(row5, text="Học từ lựa chọn của bạn:").pack(side="left")
        ttk.Button(row5, text="Học từ ảnh này", command=self.learn_now).pack(side="left", padx=4)
        ttk.Button(row5, text="Đề xuất vùng nền", command=self.suggest_now).pack(side="left", padx=2)
        ttk.Checkbutton(row5, text="Tự đề xuất khi mở ảnh", variable=self.auto_suggest).pack(side="left", padx=8)
        self.numeric_slider(row5, "Ngưỡng đề xuất", self.threshold, 0.05, 0.95, 0.05, on_change=self.on_threshold)
        ttk.Label(row5, text="(thấp: đề xuất nhiều hơn, dễ xóa nhầm hơn)", foreground="#666").pack(side="left", padx=(4, 12))
        ttk.Button(row5, text="Xóa dữ liệu đã học", command=self.forget).pack(side="left", padx=2)
        self.learn_label = ttk.Label(self, wraplength=1160, padding=(8, 4, 8, 0))
        self.learn_label.pack(fill="x")
        self.update_learn_label()

        main = ttk.Frame(self)
        main.pack(fill="both", expand=True, padx=8, pady=8)
        side = ttk.Frame(main)
        side.pack(side="left", fill="y")
        ttk.Label(side, text="Ảnh đang mở (bấm để chọn):").pack(anchor="w")
        self.listbox = tk.Listbox(side, width=28, exportselection=False, activestyle="none")
        scroll = ttk.Scrollbar(side, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=scroll.set)
        self.listbox.pack(side="left", fill="y")
        scroll.pack(side="left", fill="y")
        self.listbox.bind("<<ListboxSelect>>", self.on_list_select)
        self.view = CompareCanvas(main)
        self.view.on_click = self.on_click
        self.view.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self.status = ttk.Label(
            self, padding=(8, 0, 8, 8), wraplength=1160,
            text="Chọn ảnh để bắt đầu (có thể chọn nhiều ảnh, mỗi ảnh giữ riêng chỉnh sửa của nó). Kéo thanh trắng để so sánh, "
                 "lăn chuột để zoom, kéo ảnh để di chuyển, bấm đúp để về vừa khung. Bấm vào một khoảng nền để đổi giữa xóa và giữ vùng đó.",
        )
        self.status.pack(fill="x")

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

    def numeric_slider(self, parent, text, var, lo, hi, step, integer=False, on_change=None):
        """Thanh trượt kèm ô nhập số: kéo thanh (làm tròn theo bước) hoặc gõ số rồi nhấn Enter."""
        decimals = 0 if integer else max(0, -int(np.floor(np.log10(step) + 1e-9)))
        fmt = "{:.%df}" % decimals

        def quantize(v):
            v = min(max(float(v), lo), hi)
            v = min(max(round(v / step) * step, lo), hi)
            return int(round(v)) if integer else round(v, decimals + 1)

        txt = tk.StringVar(value=fmt.format(var.get()))
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
        bridge = auto_bridge(size) if size and d.get("bridge_on", True) else 0
        return Options(d["bg"], d["tolerance"], d["opaque"], d["connected"], d["close_gaps"], d.get("smooth", 0.0), bridge)

    # --- Cấu hình có tên ---
    def settings(self):
        return {"bg": self.bg.get(), "tolerance": round(self.tol.get(), 4), "opaque": round(self.opq.get(), 4),
                "connected": self.connected.get(), "close_gaps": self.close_gaps.get(),
                "bridge_on": self.bridge_on.get(),
                "smooth": round(self.smooth.get(), 3)}

    def apply_settings(self, d):
        for key, var, cast in (("bg", self.bg, str), ("tolerance", self.tol, float), ("opaque", self.opq, float),
                               ("connected", self.connected, bool), ("close_gaps", self.close_gaps, bool),
                               ("smooth", self.smooth, float),
                               ("bridge_on", self.bridge_on, bool)):
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
        self.apply_settings(data)
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
        self.store.put(name, dict(self.settings(), view_bg=self.view_bg.get()))
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
        return {"settings": self.settings(), "flips": [list(p) for p in self.flips.get(self.path, [])]}

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
        if not n:
            messagebox.showinfo("Khôi phục ảnh gốc", "Ảnh này chưa có vùng nào được bấm chọn thủ công.")
            return
        if messagebox.askyesno(
            "Khôi phục ảnh gốc",
            f"Bạn có chắc muốn khôi phục ảnh gốc?\n\n{n} vùng đã bấm chọn trên ảnh này sẽ bị xóa, "
            "kết quả quay về như khi chỉ dùng tự động. Có thể hoàn tác bằng Ctrl+Z.",
        ):
            self.flips.pop(self.path, None)
            self.refresh()

    # --- Ảnh ---
    def pick(self):
        """Thêm ảnh vào danh sách (không làm mất chỉnh sửa của các ảnh đang mở) rồi mở ảnh đầu tiên vừa chọn."""
        paths = [Path(p) for p in filedialog.askopenfilenames(filetypes=[("Ảnh", " ".join("*" + e for e in sorted(EXTS)))])]
        if not paths:
            return
        # So sánh theo đường dẫn chuẩn hóa: trên Windows cùng một file có thể khác chữ hoa/thường
        same = lambda p: os.path.normcase(os.path.abspath(p))
        opened = {same(f): f for f in self.files}
        paths = [opened.get(same(p), p) for p in paths]
        fresh = [p for p in dict.fromkeys(paths) if p not in self.files]
        self.files.extend(fresh)
        target = paths[0] if not fresh else fresh[0]
        self.refresh_list()
        self.load(self.files.index(target))

    def load(self, i):
        # Rời ảnh đang mở: ghi nhận thao tác đang chờ và cấu hình các thanh trượt của nó
        if self.src is not None and self.files:
            self.flush()
            self.doc_settings[self.path] = self.settings()
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
        for store in (self.flips, self.doc_settings, self.hists, self._cache):
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
        self.refresh()

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
            messagebox.showinfo("Học từ ảnh này", "Hãy bật \"Chỉ xóa nền nối với mép ảnh\": việc học áp dụng cho các khoảng nền kín.")
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
        """Đề xuất xóa các khoảng nền kín mà mô hình cho là nền; trả về số vùng đề xuất."""
        o = self.options()
        o.connected = True
        self.busy(True)
        try:
            points = suggest_points(self.remover, o, self.flips.get(self.path, []), self.learner)
        finally:
            self.busy(False)
        self._suggested.add(self.path)
        if points:
            self.flips.setdefault(self.path, []).extend(points)
            self.connected.set(True)
        return len(points)

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
        k = self.apply_suggestions()
        self.refresh()
        self.status.config(text=f"Đã đề xuất xóa {k} khoảng nền kín. Bấm vào vùng để đổi lại, Ctrl+Z để hủy đề xuất.")

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
                  suggest and f not in self._suggested and not self.flips.get(f)) for f, dst in jobs]
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
        f, dst, d, flips, suggest = task
        if stop.is_set():
            return f, "stopped"
        try:
            img = Image.open(f).convert("RGBA")
            rem = Remover(img)
            opts = self.options_from(d, img.size)
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
