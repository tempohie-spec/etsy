"""Ung dung may tinh tach nen anh thiet ke 2D (nen trang hoac den). Chay: python app.py"""
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from remove_bg import EXTS, remove_background

PREVIEW = (460, 460)


def checker(size, cell=12):
    img = Image.new("RGB", size, (235, 235, 235))
    px = img.load()
    for y in range(size[1]):
        for x in range(size[0]):
            if (x // cell + y // cell) % 2:
                px[x, y] = (200, 200, 200)
    return img


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Tach nen anh thiet ke")
        self.files, self.src, self.result = [], None, None
        self.bg = tk.StringVar(value="auto")
        self.tol = tk.DoubleVar(value=0.06)
        self.opq = tk.DoubleVar(value=0.8)

        bar = ttk.Frame(self, padding=8)
        bar.pack(fill="x")
        ttk.Button(bar, text="Chon anh", command=self.pick).pack(side="left")
        ttk.Button(bar, text="Luu anh nay", command=self.save_one).pack(side="left", padx=4)
        ttk.Button(bar, text="Xu ly ca lo", command=self.save_all).pack(side="left")
        for label, v in (("Tu dong", "auto"), ("Nen trang", "white"), ("Nen den", "black")):
            ttk.Radiobutton(bar, text=label, value=v, variable=self.bg, command=self.refresh).pack(side="left", padx=4)
        ttk.Label(bar, text="Do nhay").pack(side="left", padx=(12, 2))
        s = ttk.Scale(bar, from_=0, to=0.4, variable=self.tol, command=lambda _: self.refresh())
        s.pack(side="left")
        ttk.Label(bar, text="Do dac").pack(side="left", padx=(12, 2))
        ttk.Scale(bar, from_=0.3, to=1.0, variable=self.opq, command=lambda _: self.refresh()).pack(side="left")

        views = ttk.Frame(self, padding=8)
        views.pack()
        self.l_src, self.l_out = ttk.Label(views), ttk.Label(views)
        self.l_src.grid(row=0, column=0, padx=4)
        self.l_out.grid(row=0, column=1, padx=4)
        self.status = ttk.Label(self, text="Chon mot hoac nhieu anh de bat dau", padding=8)
        self.status.pack(fill="x")

    def pick(self):
        paths = filedialog.askopenfilenames(filetypes=[("Anh", " ".join("*" + e for e in sorted(EXTS)))])
        if not paths:
            return
        self.files = [Path(p) for p in paths]
        self.src = Image.open(self.files[0])
        self.refresh()

    def refresh(self):
        if self.src is None:
            return
        self.result = remove_background(self.src, self.bg.get(), self.tol.get(), self.opq.get())
        self.show(self.l_src, self.src.convert("RGB"), "a")
        thumb = self.fit(self.result)
        base = checker(thumb.size).convert("RGBA")
        base.alpha_composite(thumb)
        self.show(self.l_out, base.convert("RGB"), "b")
        self.status.config(text=f"{len(self.files)} anh | xem truoc: {self.files[0].name}")

    def fit(self, img):
        img = img.copy()
        img.thumbnail(PREVIEW)
        return img.convert("RGBA")

    def show(self, label, img, key):
        tk_img = ImageTk.PhotoImage(self.fit(img).convert("RGB"))
        setattr(self, "_img_" + key, tk_img)
        label.config(image=tk_img)

    def save_one(self):
        if self.result is None:
            return
        dst = filedialog.asksaveasfilename(defaultextension=".png", initialfile=self.files[0].stem + "_nobg.png")
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
            remove_background(Image.open(f), self.bg.get(), self.tol.get(), self.opq.get()).save(Path(out) / (f.stem + ".png"), "PNG")
        messagebox.showinfo("Xong", f"Da xu ly {len(self.files)} anh")


if __name__ == "__main__":
    App().mainloop()
