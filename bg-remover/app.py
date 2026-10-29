"""Ứng dụng máy tính tách nền ảnh thiết kế 2D (nền trắng hoặc đen). Chạy: python app.py"""
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

import numpy as np
from PIL import Image, ImageTk

import ai
from compare import fit_view, render_view
from learn import MIN_PER_CLASS, MIN_SAMPLES, Learner, region_features, suggest_points
from remove_bg import EXTS, SUFFIX, Options, Remover
from settings import Store

ZOOM_STEP = 1.2
MAX_ZOOM = 64.0
GRAB = 14            # px quanh thanh chia để kéo
CLICK_MAX = 4        # di chuyển tối đa (px) để tính là bấm chứ không phải kéo
PREVIEW_SIDE = 800   # cạnh dài (px) của bản thu nhỏ dùng để xem nhanh khi kéo thanh trượt
POLL_MS = 15         # chu kỳ kiểm tra kết quả xem nhanh từ luồng nền
FULL_DELAY = 350     # ms yên lặng trước khi tính lại đầy đủ
HISTORY_MAX = 100

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
            except Exception:  # noqa: BLE001 - lỗi ở bản xem nhanh không được làm sập ứng dụng
                out = None
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
        self.fast_masks = {}      # đường dẫn -> mask AI thu nhỏ
        self.result_is_preview = False
        # Dữ liệu riêng của từng ảnh: vùng đã bấm, cấu hình các thanh trượt, lịch sử hoàn tác, mask AI
        self.flips = {}           # đường dẫn -> các điểm người dùng bấm để đổi xóa/giữ vùng nền
        self.doc_settings = {}    # đường dẫn -> cấu hình các thanh trượt của ảnh đó
        self.hists = {}           # đường dẫn -> {"undo": [], "redo": [], "committed": trạng thái}
        self.ai_masks = {}
        self._ai_busy = False
        self._ai_done = None
        self._job = self._quick_poll = None
        self._gen = 0             # tăng mỗi lần tính đầy đủ hoặc đổi ảnh để bỏ các bản xem nhanh cũ
        self._restoring = False
        self.worker = PreviewWorker()
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
        self.use_ai = tk.BooleanVar(value=False)
        self.bridge = tk.IntVar(value=2)
        self.pocket = tk.DoubleVar(value=0.0)
        self.smooth = tk.DoubleVar(value=0.0)
        self.view_bg = tk.StringVar(value=next(iter(PREVIEW_BGS)))
        self.profile_var = tk.StringVar()
        self.auto_suggest = tk.BooleanVar(value=True)

        bar = ttk.Frame(self, padding=(8, 8, 8, 0))
        bar.pack(fill="x")
        ttk.Button(bar, text="Chọn ảnh", command=self.pick).pack(side="left")
        ttk.Button(bar, text="Lưu ảnh này", command=self.save_one).pack(side="left", padx=4)
        ttk.Button(bar, text="Xử lý cả lô", command=self.save_all).pack(side="left")
        ttk.Button(bar, text="<", width=3, command=lambda: self.step(-1)).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text=">", width=3, command=lambda: self.step(1)).pack(side="left")
        ttk.Button(bar, text="Đóng ảnh này", command=self.close_current).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text="Hoàn tác (Ctrl+Z)", command=self.undo).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text="Làm lại (Ctrl+Y)", command=self.redo).pack(side="left", padx=4)
        ttk.Button(bar, text="Khôi phục ảnh gốc", command=self.restore_original).pack(side="left", padx=(12, 0))

        row2 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row2.pack(fill="x")
        for label, v in (("Tự động", "auto"), ("Nền trắng", "white"), ("Nền đen", "black")):
            ttk.Radiobutton(row2, text=label, value=v, variable=self.bg, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Chỉ xóa nền nối với mép ảnh", variable=self.connected, command=self.schedule).pack(side="left", padx=(12, 4))
        ttk.Checkbutton(row2, text="Bịt khe hở nét vẽ", variable=self.close_gaps, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Dùng AI (thử nghiệm, có thể xóa nhầm)", variable=self.use_ai, command=self.toggle_ai).pack(side="left", padx=4)

        row3 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row3.pack(fill="x")
        self.numeric_slider(row3, "Độ nhạy", self.tol, 0, 0.4, 0.01)
        self.numeric_slider(row3, "Độ đặc", self.opq, 0.3, 1.0, 0.01)
        self.numeric_slider(row3, "Làm mịn viền (px)", self.smooth, 0, 2, 0.1)

        row3b = ttk.Frame(self, padding=(8, 6, 8, 0))
        row3b.pack(fill="x")
        self.numeric_slider(row3b, "Xuyên nét mảnh (px)", self.bridge, 0, 4, 1, integer=True)
        self.numeric_slider(row3b, "Tự xóa vùng kín lớn hơn (%)", self.pocket, 0, 3, 0.05)
        ttk.Label(row3b, text="(kéo thanh hoặc gõ số rồi nhấn Enter)", foreground="#666").pack(side="left", padx=12)

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
        ttk.Button(row5, text="Xóa dữ liệu đã học", command=self.forget).pack(side="left", padx=2)
        self.learn_label = ttk.Label(row5)
        self.learn_label.pack(side="left", padx=10)
        self.update_learn_label()

        self.view = CompareCanvas(self)
        self.view.on_click = self.on_click
        self.view.pack(fill="both", expand=True, padx=8, pady=8)
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
        for job in (self._job, self._quick_poll):
            if job:
                self.after_cancel(job)
        self.worker.close()
        super().destroy()

    def numeric_slider(self, parent, text, var, lo, hi, step, integer=False):
        """Thanh trượt kèm ô nhập số: kéo thanh (làm tròn theo bước) hoặc gõ số rồi nhấn Enter."""
        decimals = 0 if integer else max(0, -int(np.floor(np.log10(step) + 1e-9)))
        fmt = "{:.%df}" % decimals

        def quantize(v):
            v = min(max(float(v), lo), hi)
            v = min(max(round(v / step) * step, lo), hi)
            return int(round(v)) if integer else round(v, decimals + 1)

        txt = tk.StringVar(value=fmt.format(var.get()))
        ttk.Label(parent, text=text).pack(side="left", padx=(8, 2))

        def on_scale(v):
            var.set(quantize(v))
            self.schedule()

        ttk.Scale(parent, from_=lo, to=hi, variable=var, command=on_scale).pack(side="left")

        def on_text(_event=None):
            try:
                v = quantize(float(txt.get().strip().replace(",", ".")))
            except ValueError:
                txt.set(fmt.format(var.get()))  # gõ sai: trả về giá trị hiện tại
                return
            if v != var.get():
                var.set(v)
                self.schedule()
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

    def options(self):
        return self.options_from(self.settings())

    @staticmethod
    def options_from(d):
        return Options(d["bg"], d["tolerance"], d["opaque"], d["connected"], d["close_gaps"],
                       d["bridge"], d["min_pocket"], d.get("smooth", 0.0))

    # --- Cấu hình có tên ---
    def settings(self):
        return {"bg": self.bg.get(), "tolerance": round(self.tol.get(), 4), "opaque": round(self.opq.get(), 4),
                "connected": self.connected.get(), "close_gaps": self.close_gaps.get(), "use_ai": self.use_ai.get(),
                "bridge": int(self.bridge.get()), "min_pocket": round(self.pocket.get(), 4),
                "smooth": round(self.smooth.get(), 3)}

    def apply_settings(self, d):
        for key, var, cast in (("bg", self.bg, str), ("tolerance", self.tol, float), ("opaque", self.opq, float),
                               ("connected", self.connected, bool), ("close_gaps", self.close_gaps, bool),
                               ("use_ai", self.use_ai, bool), ("bridge", self.bridge, int),
                               ("min_pocket", self.pocket, float), ("smooth", self.smooth, float)):
            if key in d:
                try:
                    var.set(cast(d[key]))
                except (TypeError, ValueError, tk.TclError):
                    pass
        if self.bg.get() not in ("auto", "white", "black"):
            self.bg.set("auto")
        if self.use_ai.get() and not ai.available():
            self.use_ai.set(False)

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
        fresh = [p for p in dict.fromkeys(paths) if p not in self.files]
        self.files.extend(fresh)
        target = paths[0] if not fresh else fresh[0]
        self.load(self.files.index(target), auto_bridge=self.profile is None)

    def load(self, i, auto_bridge=False):
        # Rời ảnh đang mở: ghi nhận thao tác đang chờ và cấu hình các thanh trượt của nó
        if self.src is not None and self.files:
            self.flush()
            self.doc_settings[self.path] = self.settings()
        self.index = i % len(self.files)
        path = self.path
        self.src = Image.open(path).convert("RGBA")
        self.remover = Remover(self.src)
        longest = max(self.src.size)
        if longest > PREVIEW_SIDE * 1.3:
            k = PREVIEW_SIDE / longest
            small = self.src.resize((max(1, round(self.src.width * k)), max(1, round(self.src.height * k))), Image.LANCZOS)
            self.fast = Remover(small)
        else:
            self.fast = None
        if path in self.doc_settings:
            self.apply_settings(self.doc_settings[path])      # ảnh đã mở trước đó: khôi phục cấu hình riêng của nó
        else:
            if auto_bridge:
                # Nét mảnh như dây đèn dày khoảng 1/1000 cạnh dài của ảnh
                self.bridge.set(min(4, max(1, round(longest / 1000))))
            self.doc_settings[path] = self.settings()          # ảnh mới kế thừa cấu hình hiện tại
        h = self.hist()
        if h["committed"] is None:
            h["committed"] = self.state()
        if self.auto_suggest.get() and self.learner.ready and path not in self._suggested and not self.flips.get(path):
            self.status.config(text="Đang đề xuất vùng nền...")
            self.apply_suggestions()
        self.refresh(reset=True)

    def step(self, d):
        if self.files:
            self.load(self.index + d)

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
        for store in (self.flips, self.ai_masks, self.fast_masks, self.doc_settings, self.hists):
            store.pop(path, None)
        self._suggested.discard(path)
        del self.files[self.index]
        self.src = None
        self._gen += 1
        if self.files:
            self.load(min(self.index, len(self.files) - 1))
        else:
            self.remover = self.fast = self.result = None
            self.view.clear()
            self.status.config(text="Đã đóng hết ảnh. Bấm \"Chọn ảnh\" để mở ảnh khác.")

    def schedule(self):
        """Vẽ nhanh bản thu nhỏ (tính ở luồng nền) ngay, rồi tính đầy đủ khi người dùng dừng tay."""
        if self._job:
            self.after_cancel(self._job)
        if self.fast is not None and self.remover is not None:
            self.submit_quick()
            self._job = self.after(FULL_DELAY, self.refresh)
        else:
            self._job = self.after(120, self.refresh)

    def submit_quick(self):
        k = self.fast.w / self.remover.w
        o = self.options()
        if o.bridge:
            o.bridge = max(1, round(o.bridge * k))
        o.smooth *= k
        flips = [(int(x * k), int(y * k)) for x, y in self.flips.get(self.path, [])]
        mask = None
        if self.use_ai.get() and self.path in self.ai_masks:
            if self.path not in self.fast_masks:
                full = Image.fromarray(self.ai_masks[self.path], "F")
                self.fast_masks[self.path] = np.asarray(full.resize(self.fast.size, Image.BILINEAR), dtype=np.float32)
            mask = self.fast_masks[self.path]
        fast, gen = self.fast, self._gen
        self.worker.submit(lambda: (gen, fast.render(o, flips, mask)))
        if self._quick_poll is None:
            self._quick_poll = self.after(POLL_MS, self.poll_quick)

    def poll_quick(self):
        self._quick_poll = None
        busy = self.worker.busy      # đọc trạng thái trước khi lấy kết quả để không bỏ sót bản vừa xong
        res = self.worker.take()
        if res is not None and res[0] == self._gen and self.remover is not None:
            self.result = res[1]
            self.result_is_preview = True
            self.view.set_images(self.src, self.result)
            self.status.config(text=f"{self.index + 1}/{len(self.files)}: {self.path.name}  |  Xem nhanh (bản thu nhỏ), dừng tay để tính đầy đủ...")
        if busy:
            self._quick_poll = self.after(POLL_MS, self.poll_quick)

    def refresh(self, reset=False):
        if self._job:
            self.after_cancel(self._job)
        self._job = None
        self._gen += 1
        self.result_is_preview = False
        if self.remover is None:
            return
        mask = None
        if self.use_ai.get():
            mask = self.ai_masks.get(self.path)
            if mask is None:
                self.start_ai()
        self.result = self.remover.render(self.options(), self.flips.get(self.path, []), mask)
        self.view.set_images(self.src, self.result, keep_view=not reset)
        self.commit_history()
        self.doc_settings[self.path] = self.settings()
        n = len(self.flips.get(self.path, []))
        busy = "  |  Đang chạy AI..." if self._ai_busy else ""
        self.status.config(text=f"{self.index + 1}/{len(self.files)}: {self.path.name}  |  vùng đã bấm: {n}{busy}")

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
            text = f"Đã học {n} vùng ({removed} xóa, {n - removed} giữ) từ {images} ảnh"
            if not self.learner.ready:
                text += " | cần thêm dữ liệu mới bắt đầu đề xuất"
            elif self.learner.accuracy() is not None:
                text += f" | độ chính xác ước tính {self.learner.accuracy() * 100:.0f}%"
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
            mask = self.ai_masks.get(self.path) if self.use_ai.get() else None
            _, remove = self.remover.decide(o, self.flips.get(self.path, []), mask)
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

    def forget(self):
        if self.learner.stats[0] and messagebox.askyesno("Xóa dữ liệu đã học", "Xóa toàn bộ dữ liệu đã học? Không thể hoàn tác."):
            self.learner.clear()
            self.update_learn_label()

    # --- AI ---
    def toggle_ai(self):
        if self.use_ai.get():
            if not ai.available():
                self.use_ai.set(False)
                messagebox.showinfo("Chưa có AI", "Cần cài thêm thư viện onnxruntime:\n\npip install onnxruntime")
                return
            if not self.connected.get():
                self.connected.set(True)
        self.schedule()

    def start_ai(self):
        if self._ai_busy or self.src is None:
            return
        self._ai_busy = True
        path, img = self.path, self.src
        self.status.config(text="Đang chạy AI (lần đầu sẽ tải mô hình khoảng 170 MB, vui lòng chờ)...")

        def work():
            try:
                self._ai_done = (path, ai.foreground_mask(img), None)
            except Exception as e:  # noqa: BLE001 - hiển thị nguyên nhân cho người dùng
                self._ai_done = (path, None, e)

        threading.Thread(target=work, daemon=True).start()
        self.after(300, self.poll_ai)

    def poll_ai(self):
        if self._ai_done is None:
            self.after(300, self.poll_ai)
            return
        path, mask, err = self._ai_done
        self._ai_done, self._ai_busy = None, False
        if err:
            self.use_ai.set(False)
        else:
            self.ai_masks[path] = mask
        if self.files and path == self.path:
            self.refresh()
        if err:
            messagebox.showerror("Lỗi AI", str(err))

    # --- Lưu ---
    def save_one(self):
        if self.result is None:
            return
        if self.result_is_preview:
            self.refresh()  # đang hiện bản xem nhanh, cần tính lại đầy đủ trước khi lưu
        dst = filedialog.asksaveasfilename(
            defaultextension=".png", initialfile=self.path.stem + SUFFIX + ".png", filetypes=[("PNG", "*.png")],
        )
        if dst:
            self.result.save(dst, "PNG")
            self.status.config(text=f"Đã lưu {dst}")

    def save_all(self):
        if not self.files:
            return
        self.flush()
        self.doc_settings[self.path] = self.settings()
        out = filedialog.askdirectory(title="Chọn thư mục lưu")
        if not out:
            return
        for i, f in enumerate(self.files, 1):
            self.status.config(text=f"Đang xử lý {i}/{len(self.files)}: {f.name}")
            self.update()
            d = self.doc_settings.get(f) or self.settings()   # mỗi ảnh dùng cấu hình riêng của nó
            img = Image.open(f).convert("RGBA")
            mask = None
            if d.get("use_ai"):
                mask = self.ai_masks.get(f)
                if mask is None:
                    try:
                        mask = ai.foreground_mask(img)
                    except Exception as e:  # noqa: BLE001
                        messagebox.showerror("Lỗi AI", str(e))
                        return
            rem, opts, flips = Remover(img), self.options_from(d), list(self.flips.get(f, []))
            if self.auto_suggest.get() and self.learner.ready and f not in self._suggested and not flips:
                o2 = self.options_from(d)
                o2.connected = True
                flips = suggest_points(rem, o2, flips, self.learner)
                opts.connected = opts.connected or bool(flips)
            rem.render(opts, flips, mask).save(Path(out) / (f.stem + SUFFIX + ".png"), "PNG")
        self.status.config(text=f"Đã xử lý {len(self.files)} ảnh -> {out}")
        messagebox.showinfo("Xong", f"Đã xử lý {len(self.files)} ảnh")


if __name__ == "__main__":
    App().mainloop()
