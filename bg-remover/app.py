"""Ung dung may tinh tach nen anh thiet ke 2D (nen trang hoac den). Chay: python app.py"""
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from compare import fit_view, render_view
from remove_bg import EXTS, SUFFIX, remove_background

ZOOM_STEP = 1.2
MAX_ZOOM = 64.0
GRAB = 14  # px quanh thanh chia de keo


class CompareCanvas(tk.Canvas):
    """Xem truoc/sau: keo thanh chia, lan chuot de zoom, keo ben ngoai thanh de di chuyen anh."""

    def __init__(self, master, **kw):
        super().__init__(master, bg="#2b2b2b", highlightthickness=0, **kw)
        self.before = self.after_img = None
        self.scale = self.ox = self.oy = 0.0
        self.fit_scale = 1.0
        self.frac = 0.5
        self.mode = None
        self._tk = None
        self._last = (0, 0)
        self.bind("<Configure>", lambda e: self.on_resize())
        self.bind("<ButtonPress-1>", self.press)
        self.bind("<B1-Motion>", self.drag)
        self.bind("<ButtonRelease-1>", lambda e: setattr(self, "mode", None))
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
        self._last = (e.x, e.y)
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
        self.geometry("1000x720")
        self.files, self.index, self.src, self.result = [], 0, None, None
        self.bg = tk.StringVar(value="auto")
        self.tol = tk.DoubleVar(value=0.06)
        self.opq = tk.DoubleVar(value=0.8)
        self.connected = tk.BooleanVar(value=True)
        self._job = None

        bar = ttk.Frame(self, padding=8)
        bar.pack(fill="x")
        ttk.Button(bar, text="Chon anh", command=self.pick).pack(side="left")
        ttk.Button(bar, text="Luu anh nay", command=self.save_one).pack(side="left", padx=4)
        ttk.Button(bar, text="Xu ly ca lo", command=self.save_all).pack(side="left")
        ttk.Button(bar, text="<", width=3, command=lambda: self.step(-1)).pack(side="left", padx=(12, 0))
        ttk.Button(bar, text=">", width=3, command=lambda: self.step(1)).pack(side="left")

        opts = ttk.Frame(self, padding=(8, 0))
        opts.pack(fill="x")
        for label, v in (("Tu dong", "auto"), ("Nen trang", "white"), ("Nen den", "black")):
            ttk.Radiobutton(opts, text=label, value=v, variable=self.bg, command=self.schedule).pack(side="left", padx=4)
        ttk.Checkbutton(opts, text="Chi xoa nen noi voi mep anh", variable=self.connected, command=self.schedule).pack(side="left", padx=12)
        ttk.Label(opts, text="Do nhay").pack(side="left", padx=(8, 2))
        ttk.Scale(opts, from_=0, to=0.4, variable=self.tol, command=lambda _: self.schedule()).pack(side="left")
        ttk.Label(opts, text="Do dac").pack(side="left", padx=(12, 2))
        ttk.Scale(opts, from_=0.3, to=1.0, variable=self.opq, command=lambda _: self.schedule()).pack(side="left")

        self.view = CompareCanvas(self)
        self.view.pack(fill="both", expand=True, padx=8, pady=8)
        self.status = ttk.Label(
            self, padding=(8, 0, 8, 8),
            text="Chon anh de bat dau. Keo thanh trang de so sanh, lan chuot de zoom, keo anh de di chuyen, bam doi de ve vua khung.",
        )
        self.status.pack(fill="x")

    def pick(self):
        paths = filedialog.askopenfilenames(filetypes=[("Anh", " ".join("*" + e for e in sorted(EXTS)))])
        if paths:
            self.files = [Path(p) for p in paths]
            self.load(0)

    def load(self, i):
        self.index = i % len(self.files)
        self.src = Image.open(self.files[self.index]).convert("RGBA")
        self.refresh(reset=True)

    def step(self, d):
        if self.files:
            self.load(self.index + d)

    def schedule(self):
        # Gop nhieu lan keo thanh truot thanh mot lan xu ly
        if self._job:
            self.after_cancel(self._job)
        self._job = self.after(120, self.refresh)

    def process(self, img):
        return remove_background(img, self.bg.get(), self.tol.get(), self.opq.get(), self.connected.get())

    def refresh(self, reset=False):
        self._job = None
        if self.src is None:
            return
        self.result = self.process(self.src)
        self.view.set_images(self.src, self.result, keep_view=not reset)
        self.status.config(text=f"{self.index + 1}/{len(self.files)}: {self.files[self.index].name}")

    def save_one(self):
        if self.result is None:
            return
        dst = filedialog.asksaveasfilename(
            defaultextension=".png", initialfile=self.files[self.index].stem + SUFFIX + ".png",
            filetypes=[("PNG", "*.png")],
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
        for f in self.files:
            self.process(Image.open(f)).save(Path(out) / (f.stem + SUFFIX + ".png"), "PNG")
        messagebox.showinfo("Xong", f"Da xu ly {len(self.files)} anh")


if __name__ == "__main__":
    App().mainloop()
