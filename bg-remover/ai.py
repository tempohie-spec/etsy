"""Nhan dien nen bang AI (tuy chon). Can: pip install onnxruntime

Mo hinh U2-Net duoc tai ve mot lan vao ~/.bg-remover/models. AI chi dung de quyet dinh cac
khoang nen kin nam ben trong thiet ke co phai la nen hay khong; vien van do thuat toan mau xu ly.
"""
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/"
MODEL = "isnet-general-use"
# ten mo hinh -> (kich thuoc dau vao, do lech chuan chuan hoa)
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


def model_path(name=MODEL):
    path = MODEL_DIR / (name + ".onnx")
    if not path.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        try:
            urllib.request.urlretrieve(RELEASE + name + ".onnx", tmp)
        except OSError as e:
            tmp.unlink(missing_ok=True)
            raise AIUnavailable(f"Khong tai duoc mo hinh AI ({e}). Kiem tra ket noi mang roi thu lai.")
        tmp.rename(path)
    return path


def _get_session():
    global _session
    if _session is None:
        try:
            import onnxruntime as ort
        except ImportError:
            raise AIUnavailable("Chua cai onnxruntime. Chay: pip install onnxruntime")
        _session = ort.InferenceSession(str(model_path()), providers=["CPUExecutionProvider"])
    return _session


def foreground_mask(img):
    """Tra ve mang float32 (H, W) trong 0..1, gia tri cao la thiet ke, thap la nen."""
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
