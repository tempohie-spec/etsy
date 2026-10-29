"""Nhận diện nền bằng AI (tùy chọn). Cần: pip install onnxruntime

Mô hình được tải về một lần vào ~/.bg-remover/models. AI chỉ dùng để quyết định các
khoảng nền kín nằm bên trong thiết kế có phải là nền hay không; viền vẫn do thuật toán màu xử lý.
"""
import shutil
import ssl
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/"
MODEL = "isnet-general-use"
# tên mô hình -> (kích thước đầu vào, độ lệch chuẩn dùng để chuẩn hóa)
MODELS = {
    "isnet-general-use": (1024, (1.0, 1.0, 1.0)),
    "u2net": (320, (0.229, 0.224, 0.225)),
}
MODEL_DIR = Path.home() / ".bg-remover" / "models"
MEAN = np.array([0.485, 0.456, 0.406], np.float32)

_session = None


class AIUnavailable(Exception):
    pass


def available():
    try:
        import onnxruntime  # noqa: F401
        return True
    except ImportError:
        return False


def _contexts():
    """Thử bộ chứng chỉ của hệ thống trước, nếu thất bại thì dùng bộ chứng chỉ đi kèm (certifi)."""
    yield ssl.create_default_context()
    try:
        import certifi
    except ImportError:
        return
    yield ssl.create_default_context(cafile=certifi.where())


def _download(url, dest):
    error = None
    for ctx in _contexts():
        try:
            with urllib.request.urlopen(url, context=ctx, timeout=60) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return
        except OSError as e:  # gồm cả lỗi mạng và lỗi chứng chỉ SSL
            error = e
    raise error


def model_path(name=MODEL):
    path = MODEL_DIR / (name + ".onnx")
    if not path.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        url = RELEASE + name + ".onnx"
        try:
            _download(url, tmp)
        except OSError as e:
            tmp.unlink(missing_ok=True)
            raise AIUnavailable(
                f"Không tải được mô hình AI ({e}).\n\n"
                f"Có thể tải thủ công: mở link sau bằng trình duyệt\n{url}\n"
                f"rồi chép file vào thư mục\n{MODEL_DIR}\nvà thử lại."
            )
        tmp.rename(path)
    return path


def _get_session():
    global _session
    if _session is None:
        try:
            import onnxruntime as ort
        except ImportError:
            raise AIUnavailable("Chưa cài onnxruntime. Chạy: pip install onnxruntime")
        _session = ort.InferenceSession(str(model_path()), providers=["CPUExecutionProvider"])
    return _session


def foreground_mask(img):
    """Trả về mảng float32 (H, W) trong 0..1, giá trị cao là thiết kế, thấp là nền."""
    sess = _get_session()
    size, std = MODELS[MODEL]
    rgb = img.convert("RGB")
    x = np.asarray(rgb.resize((size, size), Image.LANCZOS), dtype=np.float32)
    x = (x / max(float(x.max()), 1e-6) - MEAN) / np.array(std, np.float32)
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    pred = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)
    return np.asarray(mask, dtype=np.float32) / 255.0
