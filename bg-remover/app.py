"""Ung dung may tinh tach nen anh thiet ke 2D (nen trang hoac den). Chay: python app.py"""
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import numpy as np
from PIL import Image, ImageTk

import ai
from compare import fit_view, render_view
from remove_bg import EXTS, SUFFIX, Options, Remover

ZOOM_STEP = 1.2
MAX_ZOOM = 64.0
GRAB = 14       # px quanh thanh chia de keo
CLICK_MAX = 4   # di chuyen toi da (px) de tinh la bam chu khong phai keo
PREVIEW_SIDE = 900   # canh dai (px) cua ban thu nho dung de xem nhanh khi keo thanh truot
QUICK_DELAY = 30     # ms tu luc doi tuy chon den luc ve ban xem nhanh
FULL_DELAY = 350     # ms yen lang truoc khi tinh lai day du


class CompareCanvas(tk.Canvas):
    """Xem truoc/sau: keo thanh chia, lan chuot de zoom, keo ben ngoai thanh de di chuyen anh,
    bam (khong keo) vao anh de goi on_click(x, y) theo toa do anh goc."""

    def __init__(self, master, **kw):
        super().__init__(master, bg="#2b2b2b", highlightthickness=0, **kw)
        self.before = self.after_img = None
        self.scale = self.ox = self.oy = 0.0
        self.fit_scale = 1.0
        self.frac = 0.5
        self.mode = None
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
        img = render_view(self.before, self.after_img, (w, h), self.scale, self.ox, self.oy, self.div_x())
        self._tk = ImageTk.PhotoImage(img)
        self.delete("all")
        self.create_image(0, 0, image=self._tk, anchor="nw")
        x = self.div_x()
        self.create_line(x, 0, x, h, fill="white", width=2)
        self.create_oval(x - 16, h / 2 - 16, x + 16, h / 2 + 16, fill="white", outline="#999")
        self.create_text(x, h / 2, text="<>", fill="#333", font=("Arial", 10, "bold"))
        self.label(8, 8, "Truoc", "nw")
        self.label(w - 8, 8, "Sau", "ne")

    def label(self, x, y, text, anchor):
        t = self.create_text(x, y, text=text, fill="white", anchor=anchor, font=("Arial", 10, "bold"))
        bx = self.bbox(t)
        r = self.create_rectangle(bx[0] - 6, bx[1] - 3, bx[2] + 6, bx[3] + 3, fill="#444", outline="")
        self.tag_lower(r, t)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Tach nen anh thiet ke")
        self.geometry("1100x760")
        self.files, self.index = [], 0
        self.src = self.remover = self.result = None
        self.fast = None          # Remover cua ban thu nho, dung de xem nhanh
        self.fast_masks = {}      # duong dan -> mask AI thu nho
        self.result_is_preview = False
        self._quick_job = None
        self.flips = {}       # duong dan -> cac diem nguoi dung bam de doi xoa/giu vung nen
        self.ai_masks = {}    # duong dan -> mask AI
        self._ai_busy = False
        self._ai_done = None
        self._job = None

        self.bg = tk.StringVar(value="auto")
        self.tol = tk.DoubleVar(value=0.06)
        self.opq = tk.DoubleVar(value=0.8)
        self.connected = tk.BooleanVar(value=True)
        self.close_gaps = tk.BooleanVar(value=False)
        self.use_ai = tk.BooleanVar(value=False)
        self.bridge = tk.IntVar(value=2)
        self.pocket = tk.DoubleVar(value=0.0)

        bar = ttk.Frame(self, padding=(8, 8, 8, 0))
        bar.pack(fill="x")
        ttk.Button(bar, text="Chon anh", command=self.pick).pack(side="left")
        ttk.Button(bar, text="Luu anh nay", command=self.save_one).pack(side="left", padx=4)
        ttk.Button(bar, text="Xu ly ca lo", command=self.save_all).pack(side="left")
        ttk.Button(bar, text="<", width=3, command=lambda: self.step(-1)).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text=">", width=3, command=lambda: self.step(1)).pack(side="left")
        ttk.Button(bar, text="Hoan tac vung vua bam", command=self.undo).pack(side="left", padx=(12, 0))

        row2 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row2.pack(fill="x")
        for label, v in (("Tu dong", "auto"), ("Nen trang", "white"), ("Nen den", "black")):
            ttk.Radiobutton(row2, text=label, value=v, variable=self.bg, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Chi xoa nen noi voi mep anh", variable=self.connected, command=self.schedule).pack(side="left", padx=(12, 4))
        ttk.Checkbutton(row2, text="Bit khe ho net ve", variable=self.close_gaps, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(row2, text="Dung AI (thu nghiem)", variable=self.use_ai, command=self.toggle_ai).pack(side="left", padx=4)

        row3 = ttk.Frame(self, padding=(8, 6, 8, 0))
        row3.pack(fill="x")
        self.slider(row3, "Do nhay", self.tol, 0, 0.4, "{:.2f}")
        self.slider(row3, "Do dac", self.opq, 0.3, 1.0, "{:.2f}")
        self.slider(row3, "Xuyen net manh (px)", self.bridge, 0, 4, "{:d}", integer=True)
        self.slider(row3, "Tu xoa vung kin lon hon (%)", self.pocket, 0, 3, "{:.2f}")

        self.view = CompareCanvas(self)
        self.view.on_click = self.on_click
        self.view.pack(fill="both", expand=True, padx=8, pady=8)
        self.status = ttk.Label(
            self, padding=(8, 0, 8, 8), wraplength=1060,
            text="Chon anh de bat dau. Keo thanh trang de so sanh, lan chuot de zoom, keo anh de di chuyen, "
                 "bam doi de ve vua khung. Bam vao mot khoang nen de doi giua xoa va giu vung do.",
        )
        self.status.pack(fill="x")

    def slider(self, parent, text, var, lo, hi, fmt, integer=False):
        ttk.Label(parent, text=text).pack(side="left", padx=(8, 2))
        value = ttk.Label(parent, text=fmt.format(var.get()), width=5)

        def changed(v):
            if integer:
                var.set(int(round(float(v))))
            value.config(text=fmt.format(var.get()))
            self.schedule()

        ttk.Scale(parent, from_=lo, to=hi, variable=var, command=changed).pack(side="left")
        value.pack(side="left")

    @property
    def path(self):
        return self.files[self.index]

    def options(self):
        return Options(self.bg.get(), self.tol.get(), self.opq.get(), self.connected.get(),
                       self.close_gaps.get(), int(self.bridge.get()), self.pocket.get())

    def pick(self):
        paths = filedialog.askopenfilenames(filetypes=[("Anh", " ".join("*" + e for e in sorted(EXTS)))])
        if paths:
            self.files = [Path(p) for p in paths]
            self.load(0, auto_bridge=True)

    def load(self, i, auto_bridge=False):
        self.index = i % len(self.files)
        self.src = Image.open(self.path).convert("RGBA")
        self.remover = Remover(self.src)
        longest = max(self.src.size)
        if longest > PREVIEW_SIDE * 1.3:
            k = PREVIEW_SIDE / longest
            small = self.src.resize((max(1, round(self.src.width * k)), max(1, round(self.src.height * k))), Image.LANCZOS)
            self.fast = Remover(small)
        else:
            self.fast = None
        if auto_bridge:
            # Net manh dung nhu day den dai khoang 1/1000 canh dai cua anh
            self.bridge.set(min(4, max(1, round(max(self.src.size) / 1000))))
        self.refresh(reset=True)

    def step(self, d):
        if self.files:
            self.load(self.index + d)

    def schedule(self):
        """Ve nhanh bang ban thu nho ngay, roi tinh day du khi nguoi dung dung tay."""
        for job in (self._job, self._quick_job):
            if job:
                self.after_cancel(job)
        self._quick_job = None
        if self.fast is not None:
            self._quick_job = self.after(QUICK_DELAY, self.quick)
            self._job = self.after(FULL_DELAY, self.refresh)
        else:
            self._job = self.after(120, self.refresh)

    def quick(self):
        self._quick_job = None
        if self.fast is None or self.remover is None:
            return
        k = self.fast.w / self.remover.w
        o = self.options()
        if o.bridge:
            o.bridge = max(1, round(o.bridge * k))
        flips = [(int(x * k), int(y * k)) for x, y in self.flips.get(self.path, [])]
        mask = None
        if self.use_ai.get() and self.path in self.ai_masks:
            if self.path not in self.fast_masks:
                full = Image.fromarray(self.ai_masks[self.path], "F")
                self.fast_masks[self.path] = np.asarray(full.resize(self.fast.size, Image.BILINEAR), dtype=np.float32)
            mask = self.fast_masks[self.path]
        small = self.fast.render(o, flips, mask)
        self.result = small.resize(self.src.size, Image.BILINEAR)
        self.result_is_preview = True
        self.view.set_images(self.src, self.result)
        self.status.config(text=f"{self.index + 1}/{len(self.files)}: {self.path.name}  |  Xem nhanh (ban thu nho), dung tay de tinh day du...")

    def refresh(self, reset=False):
        for job in (self._job, self._quick_job):
            if job:
                self.after_cancel(job)
        self._job = self._quick_job = None
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
        n = len(self.flips.get(self.path, []))
        busy = "  |  Dang chay AI..." if self._ai_busy else ""
        self.status.config(text=f"{self.index + 1}/{len(self.files)}: {self.path.name}  |  vung da bam: {n}{busy}")

    def on_click(self, x, y):
        if self.remover is None:
            return
        if not self.connected.get():
            self.connected.set(True)  # chon vung chi co nghia khi xet vung nen noi voi mep anh
        if not self.remover.region_at(self.options(), x, y):
            self.status.config(text="Diem nay khong phai khoang nen (hay bam vao khoang trang hoac den can xoa/giu).")
            return
        self.flips.setdefault(self.path, []).append((x, y))
        self.refresh()

    def undo(self):
        if self.files and self.flips.get(self.path):
            self.flips[self.path].pop()
            self.refresh()

    # --- AI ---
    def toggle_ai(self):
        if self.use_ai.get():
            if not ai.available():
                self.use_ai.set(False)
                messagebox.showinfo("Chua co AI", "Can cai them thu vien onnxruntime:\n\npip install onnxruntime")
                return
            if not self.connected.get():
                self.connected.set(True)
        self.schedule()

    def start_ai(self):
        if self._ai_busy or self.src is None:
            return
        self._ai_busy = True
        path, img = self.path, self.src
        self.status.config(text="Dang chay AI (lan dau se tai mo hinh khoang 170 MB, vui long cho)...")

        def work():
            try:
                self._ai_done = (path, ai.foreground_mask(img), None)
            except Exception as e:  # noqa: BLE001 - hien thi nguyen nhan cho nguoi dung
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
            messagebox.showerror("Loi AI", str(err))

    # --- Luu ---
    def save_one(self):
        if self.result is None:
            return
        if self.result_is_preview:
            self.refresh()  # dang hien ban xem nhanh, can tinh lai day du truoc khi luu
        dst = filedialog.asksaveasfilename(
            defaultextension=".png", initialfile=self.path.stem + SUFFIX + ".png", filetypes=[("PNG", "*.png")],
        )
        if dst:
            self.result.save(dst, "PNG")
            self.status.config(text=f"Da luu {dst}")

    def save_all(self):
        if not self.files:
            return
        out = filedialog.askdirectory(title="Chon thu muc luu")
        if not out:
            return
        for i, f in enumerate(self.files, 1):
            self.status.config(text=f"Dang xu ly {i}/{len(self.files)}: {f.name}")
            self.update()
            img = Image.open(f).convert("RGBA")
            mask = None
            if self.use_ai.get():
                mask = self.ai_masks.get(f)
                if mask is None:
                    try:
                        mask = ai.foreground_mask(img)
                    except Exception as e:  # noqa: BLE001
                        messagebox.showerror("Loi AI", str(e))
                        return
            Remover(img).render(self.options(), self.flips.get(f, []), mask).save(Path(out) / (f.stem + SUFFIX + ".png"), "PNG")
        self.status.config(text=f"Da xu ly {len(self.files)} anh -> {out}")
        messagebox.showinfo("Xong", f"Da xu ly {len(self.files)} anh")


if __name__ == "__main__":
    App().mainloop()
