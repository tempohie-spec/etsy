"""Học từ các lần bấm chọn vùng nền của người dùng để tự đề xuất khoảng nền kín.

Mỗi khoảng nền kín (không nối với mép ảnh) là một mẫu: đặc trưng của vùng + quyết định cuối cùng
của người dùng (xóa hay giữ). Mô hình là một rừng ngẫu nhiên nhỏ viết bằng numpy, huấn luyện ngay
trên máy trong vài giây, không cần GPU hay thư viện học máy nào khác.
"""
import json
from pathlib import Path

import numpy as np
from scipy import ndimage

STORE_PATH = Path.home() / ".bg-remover" / "learned.json"

FEATURES = [
    "log_dien_tich", "do_day_bbox", "log_ti_le_khung", "do_tron", "vien_toi", "vien_sang", "vien_mau",
    "xa_tam_thiet_ke", "xa_nen_ngoai", "do_lech_nen_tb", "ti_le_trang_tinh",
]
MIN_AREA = 2e-5      # vùng nhỏ hơn tỉ lệ này của diện tích ảnh coi là nhiễu, không học và không đề xuất
RING = 5             # px: độ rộng dải viền quanh vùng để đo màu nét bao
MIN_SAMPLES = 20
MIN_PER_CLASS = 3
MAX_SAMPLES = 30000


def region_features(rem, o):
    """Đặc trưng của các khoảng nền kín. Trả về (ids, X) với X có len(FEATURES) cột.

    Ảnh lớn được lấy mẫu một nửa độ phân giải cho nhanh; mọi đặc trưng đều là tỉ lệ nên không đổi ý nghĩa.
    """
    full, areas, border = rem._regions_for(o)
    step = 2 if full.size > 1_500_000 else 1
    labels = np.ascontiguousarray(full[::step, ::step])
    h, w = labels.shape
    n = len(areas)
    area_all = np.bincount(labels.ravel(), minlength=n)
    keep = ~border & (areas >= MIN_AREA * full.size) & (area_all > 0)
    keep[0] = False
    ids = np.nonzero(keep)[0]
    if ids.size == 0:
        return ids, np.zeros((0, len(FEATURES)))

    flat = labels.ravel()
    area = area_all[ids].astype(np.float64)
    objs = ndimage.find_objects(labels)
    bw = np.array([objs[i - 1][1].stop - objs[i - 1][1].start for i in ids], np.float64)
    bh = np.array([objs[i - 1][0].stop - objs[i - 1][0].start for i in ids], np.float64)

    cy = np.bincount(flat, weights=np.repeat(np.arange(h), w), minlength=n)[ids] / area
    cx = np.bincount(flat, weights=np.tile(np.arange(w), h), minlength=n)[ids] / area

    # Chu vi: số pixel của vùng có láng giềng (4 hướng) thuộc nhãn khác
    edge = np.zeros(labels.shape, bool)
    m = labels[:-1] != labels[1:]
    edge[:-1] |= m & (labels[:-1] > 0)
    edge[1:] |= m & (labels[1:] > 0)
    m = labels[:, :-1] != labels[:, 1:]
    edge[:, :-1] |= m & (labels[:, :-1] > 0)
    edge[:, 1:] |= m & (labels[:, 1:] > 0)
    perim = np.bincount(labels[edge], minlength=n)[ids].astype(np.float64)

    # Độ lệch so với màu nền ngay trong vùng: khoảng nền thật là trắng/đen tinh, ruột găng tay có đổ bóng
    dist = np.ascontiguousarray(rem.distance(rem.background(o.bg))[::step, ::step]).ravel()
    mean_dist = np.bincount(flat, weights=dist, minlength=n)[ids] / area
    pure = np.bincount(flat, weights=(dist < 0.01).astype(np.float64), minlength=n)[ids] / area

    # Màu của dải nét bao quanh vùng: gán mỗi pixel thiết kế gần vùng nhất vào vùng đó
    rgb = rem.rgb[::step, ::step].astype(np.float32) / 255.0
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    sat = rgb.max(axis=-1) - rgb.min(axis=-1)
    design = labels == 0
    d, idx = ndimage.distance_transform_edt(design, return_indices=True)
    sel = design & (d <= RING / step)
    ring_label = labels[idx[0][sel], idx[1][sel]]
    cnt = np.maximum(np.bincount(ring_label, minlength=n), 1)
    ring_dark = np.bincount(ring_label, weights=(lum[sel] < 0.25).astype(np.float64), minlength=n)[ids] / cnt[ids]
    ring_lum = np.bincount(ring_label, weights=lum[sel], minlength=n)[ids] / cnt[ids]
    ring_sat = np.bincount(ring_label, weights=sat[sel], minlength=n)[ids] / cnt[ids]

    # Vị trí: xa tâm thiết kế bao nhiêu, và gần nền ngoài bao nhiêu
    exterior = border[labels]
    inside = ~exterior
    iy, ix = np.nonzero(inside)
    if iy.size:
        gy, gx = iy.mean(), ix.mean()
        radius = max(np.sqrt(inside.sum() / np.pi), 1.0)
    else:
        gy, gx, radius = h / 2, w / 2, max(h, w) / 2
    far_center = np.hypot(cy - gy, cx - gx) / radius
    dext = ndimage.distance_transform_edt(~exterior)
    to_exterior = np.array([dext[objs[i - 1]][labels[objs[i - 1]] == i].min() for i in ids]) / np.hypot(h, w)

    X = np.column_stack([
        np.log10(area / (h * w)), area / (bw * bh), np.log(bw / bh), 4 * np.pi * area / np.maximum(perim, 1) ** 2,
        ring_dark, ring_lum, ring_sat, far_center, to_exterior, mean_dist, pure,
    ])
    return ids, X


def representative_point(labels, label, objs=None):
    """Một pixel nằm trong vùng, gần tâm vùng nhất, dạng (x, y) theo tọa độ ảnh."""
    sl = (objs or ndimage.find_objects(labels))[label - 1]
    ys, xs = np.nonzero(labels[sl] == label)
    k = int(np.argmin((ys - ys.mean()) ** 2 + (xs - xs.mean()) ** 2))
    return int(xs[k] + sl[1].start), int(ys[k] + sl[0].start)


def suggest_points(rem, o, flips, learner, threshold=0.5):
    """Các điểm (x, y) nằm trong những khoảng nền kín mà mô hình cho là nên xóa (hiện đang được giữ)."""
    if not learner.ready:
        return []
    labels, remove = rem.decide(o, flips)
    ids, X = region_features(rem, o)
    if not len(ids):
        return []
    prob = learner.predict(X)
    chosen = [int(i) for i, p in zip(ids, prob) if p >= threshold and not remove[i]]
    objs = ndimage.find_objects(labels) if chosen else None
    return [representative_point(labels, i, objs) for i in chosen]


class Forest:
    """Rừng ngẫu nhiên nhị phân nhỏ: cây quyết định theo Gini, lấy mẫu bootstrap và chọn ngẫu nhiên đặc trưng."""

    def __init__(self, trees=40, depth=6, leaf=2, seed=0):
        self.n_trees, self.depth, self.leaf, self.seed = trees, depth, leaf, seed
        self.trees = []

    def fit(self, X, y):
        rng = np.random.default_rng(self.seed)
        n, f = X.shape
        k = max(1, int(round(np.sqrt(f))))
        self.trees = [self._grow(X[i], y[i], 0, rng, k) for i in (rng.integers(0, n, n) for _ in range(self.n_trees))]
        return self

    def _split(self, X, y, feats):
        n = len(y)
        best = (None, None, np.inf)
        for f in feats:
            order = np.argsort(X[:, f], kind="stable")
            xs, ys = X[order, f], y[order]
            left_pos = np.cumsum(ys)[:-1]
            left_n = np.arange(1, n)
            right_n = n - left_n
            pl, pr = left_pos / left_n, (ys.sum() - left_pos) / right_n
            gini = left_n * pl * (1 - pl) + right_n * pr * (1 - pr)
            gini[(xs[1:] == xs[:-1]) | (left_n < self.leaf) | (right_n < self.leaf)] = np.inf
            j = int(np.argmin(gini))
            if gini[j] < best[2]:
                best = (f, (xs[j] + xs[j + 1]) / 2, gini[j])
        return best

    def _grow(self, X, y, depth, rng, k):
        p = float(y.mean())
        if depth >= self.depth or len(y) < 2 * self.leaf or p in (0.0, 1.0):
            return p
        f, thr, g = self._split(X, y, rng.choice(X.shape[1], k, replace=False))
        if f is None:
            f, thr, g = self._split(X, y, range(X.shape[1]))
        if f is None or not np.isfinite(g):
            return p
        m = X[:, f] <= thr
        return (f, thr, self._grow(X[m], y[m], depth + 1, rng, k), self._grow(X[~m], y[~m], depth + 1, rng, k))

    @staticmethod
    def _walk(node, X):
        if not isinstance(node, tuple):
            return np.full(len(X), node)
        f, thr, left, right = node
        m = X[:, f] <= thr
        out = np.empty(len(X))
        out[m] = Forest._walk(left, X[m])
        out[~m] = Forest._walk(right, X[~m])
        return out

    def predict_proba(self, X):
        return np.mean([self._walk(t, X) for t in self.trees], axis=0)


class Learner:
    """Kho mẫu học theo từng ảnh (lưu ở ~/.bg-remover/learned.json) và mô hình huấn luyện từ chúng."""

    def __init__(self, path=STORE_PATH):
        self.path = Path(path)
        self.images = {}      # khóa ảnh -> {"X": [[...]], "y": [0/1, ...]}
        self._forest = None
        self._accuracy = None
        self.load()

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            ok = data.get("features") == FEATURES and isinstance(data.get("images"), dict)
            self.images = data["images"] if ok else {}  # đổi bộ đặc trưng thì dữ liệu cũ không còn dùng được
        except (OSError, ValueError, AttributeError):
            self.images = {}
        self._forest = self._accuracy = None

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"features": FEATURES, "images": self.images}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, key, X, y):
        """Thêm (hoặc thay thế) các mẫu của một ảnh."""
        self.images.pop(key, None)
        self.images[key] = {"X": np.round(np.asarray(X, float), 5).tolist(), "y": [int(v) for v in y]}
        while sum(len(v["y"]) for v in self.images.values()) > MAX_SAMPLES and len(self.images) > 1:
            self.images.pop(next(iter(self.images)))  # bỏ ảnh học cũ nhất
        self.save()
        self._forest = self._accuracy = None

    def clear(self):
        self.images = {}
        self._forest = self._accuracy = None
        self.save()

    def _data(self, keys=None):
        parts = [v for k, v in self.images.items() if keys is None or k in keys]
        if not parts:
            return np.zeros((0, len(FEATURES))), np.zeros(0)
        return np.vstack([np.array(v["X"]) for v in parts]), np.concatenate([np.array(v["y"], float) for v in parts])

    @property
    def stats(self):
        """(số mẫu, số ảnh, số mẫu 'xóa')."""
        _, y = self._data()
        return len(y), len(self.images), int(y.sum())

    @property
    def ready(self):
        n, _, pos = self.stats
        return n >= MIN_SAMPLES and pos >= MIN_PER_CLASS and n - pos >= MIN_PER_CLASS

    def predict(self, X):
        if self._forest is None:
            X0, y0 = self._data()
            self._forest = Forest().fit(X0, y0)
        return self._forest.predict_proba(np.asarray(X, float))

    def accuracy(self):
        """Độ chính xác ước tính, kiểm tra chéo theo ảnh (huấn luyện trên ảnh khác, thử trên ảnh còn lại).
        Trả về None nếu chưa đủ ảnh."""
        if self._accuracy is None and len(self.images) >= 3 and self.ready:
            keys = list(self.images)
            folds = min(5, len(keys))
            correct = total = 0
            for f in range(folds):
                test = keys[f::folds]
                Xt, yt = self._data(test)
                Xr, yr = self._data([k for k in keys if k not in test])
                if not len(yt) or yr.sum() == 0 or yr.sum() == len(yr):
                    continue
                pred = Forest(trees=20, seed=f).fit(Xr, yr).predict_proba(Xt) >= 0.5
                correct += int((pred == (yt > 0.5)).sum())
                total += len(yt)
            self._accuracy = correct / total if total else None
        return self._accuracy
